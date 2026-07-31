import type { Prisma, BetaInvitation } from "@/app/generated/prisma/client";
import type { AccessRequestTriageStatus } from "@/app/generated/prisma/enums";
import { InvitationConflictType } from "@/app/generated/prisma/enums";
import { prisma } from "./prisma";
import {
  buildInvitationResult,
  issueBetaInvitationWithTx,
  isSerializationFailure,
  type IssueBetaInvitationResult,
} from "./betaInvitation";
import {
  resolveInvitationConflict,
  describeInvitationConflict,
  toInvitationConflictType,
  BetaInvitationConflictError,
  type InvitationConflictDetail,
} from "./invitationConflict";
import {
  runAccessRequestTriageBeforeLockHook,
  runAccessRequestTriageAfterLockHook,
  type AccessRequestTriageLockOperation,
} from "./accessRequestTriageTestHooks";

/**
 * Operator triage workflow for beta AccessRequests (#177): approve/decline/
 * resolve-as-already-has-access, reopen a prior decision, and convert an
 * approved request into a BetaInvitation.
 *
 * Mirrors the FeedbackTriage split (#176): AccessRequest itself is the
 * immutable submission; AccessRequestTriage is the mutable "current state"
 * projection (one row per request, created lazily); AccessRequestTriageEvent
 * is the append-only decision trail (ADR-004 — never overwritten or deleted).
 *
 * Every action here resolves the acting user's identity from the database
 * INSIDE the same transaction that writes the event (never trusted from the
 * caller), and every state-mutating action takes a `SELECT … FOR UPDATE`
 * lock on the projection row first, so two concurrent decisions on the same
 * request always serialize rather than racing.
 */

const REASON_MIN = 1;
const REASON_MAX = 500;
const NOTE_MIN = 1;
const NOTE_MAX = 2000;
// Exported so the wave-options combobox source (accessRequestInbox.ts) can
// filter out any legacy/directly-seeded BetaInvitation.campaign value this
// same bound would reject at conversion time (#177 review) — campaign has
// no DB-level length constraint of its own.
export const WAVE_MIN = 1;
export const WAVE_MAX = 80;
const PROJECTION_REASON_MAX = 500;

const CONVERT_MAX_RETRIES = 3;

export type AccessRequestTriageProjection = {
  accessRequestId: string;
  status: AccessRequestTriageStatus;
  linkedInvitationId: string | null;
  betaWave: string | null;
  conflictUserId: string | null;
  conflictUserIdSnapshot: string | null;
  conflictUserEmail: string | null;
  conflictUserDisplayName: string | null;
  conflictAllianceId: string | null;
  conflictAllianceIdSnapshot: string | null;
  conflictAllianceName: string | null;
  conflictMembershipCount: number | null;
  currentReason: string | null;
  stateRevision: number;
  lastEventAt: Date | null;
  lastEventActorEmail: string | null;
  lastEventActorDisplayName: string | null;
  lastStateChangeAt: Date | null;
  lastStateChangeActorEmail: string | null;
  lastStateChangeActorDisplayName: string | null;
};

export type AccessRequestTriageActionResult =
  | { ok: true; projection: AccessRequestTriageProjection }
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "VALIDATION"; message: string }
  | { ok: false; code: "STALE_CONFLICT"; conflict: AccessRequestTriageProjection }
  | {
      ok: false;
      code: "REOPEN_DENIED_ACCESS_STILL_EXISTS";
      projection: AccessRequestTriageProjection;
      message: string;
    };

export type ConvertAccessRequestResult =
  | ({
      ok: true;
      projection: AccessRequestTriageProjection;
      createdNow: boolean;
      /** False for an idempotent re-conversion — the caller must not retry delivery. */
      shouldDeliver: boolean;
    } & IssueBetaInvitationResult)
  | { ok: false; code: "NOT_FOUND" }
  | { ok: false; code: "VALIDATION"; message: string }
  | { ok: false; code: "STALE_CONFLICT"; conflict: AccessRequestTriageProjection }
  | {
      ok: false;
      code: "CONVERSION_BLOCKED";
      projection: AccessRequestTriageProjection;
      conflictType: InvitationConflictType;
      message: string;
    };

function toProjection(row: AccessRequestTriageProjection): AccessRequestTriageProjection {
  return row;
}

/** Strip control/newline characters, matching sanitizeDeliveryFailureReason's convention (#175). */
function sanitizeOperatorText(raw: string): string {
  return raw.replace(/[\u0000-\u001F\u007F]+/g, " ").trim();
}

type TextValidation = { ok: true; value: string } | { ok: false; message: string };

function validateBoundedText(
  raw: string,
  { min, max, label }: { min: number; max: number; label: string },
): TextValidation {
  const cleaned = sanitizeOperatorText(raw);
  if (cleaned.length < min) {
    return { ok: false, message: `${label} is required` };
  }
  if (cleaned.length > max) {
    return { ok: false, message: `${label} must be ${max} characters or fewer` };
  }
  return { ok: true, value: cleaned };
}

/** Bound the denormalized display column without losing the full text (which lives in the event). */
function truncateForProjection(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

async function resolveActor(
  tx: Prisma.TransactionClient,
  actorUserId: string,
): Promise<{ email: string; displayName: string } | null> {
  return tx.user.findUnique({
    where: { id: actorUserId },
    select: { email: true, displayName: true },
  });
}

/**
 * Lazily create (defaulting to PENDING) and lock the AccessRequestTriage
 * projection row for `accessRequestId`, mirroring FeedbackTriage's
 * ensureTriageProjectionLocked. Caller must have already confirmed the
 * AccessRequest itself exists (a Restrict FK would otherwise surface as a
 * raw constraint violation from the INSERT, not a clean NOT_FOUND).
 */
async function ensureAccessRequestTriageLocked(
  tx: Prisma.TransactionClient,
  accessRequestId: string,
  operation: AccessRequestTriageLockOperation,
): Promise<AccessRequestTriageProjection | null> {
  await runAccessRequestTriageBeforeLockHook({ accessRequestId, operation });

  const locked = await tx.$queryRaw<AccessRequestTriageProjection[]>`
    SELECT * FROM "AccessRequestTriage" WHERE "accessRequestId" = ${accessRequestId} FOR UPDATE
  `;

  if (locked.length > 0) {
    await runAccessRequestTriageAfterLockHook({ accessRequestId, operation });
    return locked[0]!;
  }

  await tx.$executeRaw`
    INSERT INTO "AccessRequestTriage" ("accessRequestId", "status", "stateRevision")
    VALUES (${accessRequestId}, 'PENDING'::"AccessRequestTriageStatus", 0)
    ON CONFLICT ("accessRequestId") DO NOTHING
  `;

  const lockedAfterCreate = await tx.$queryRaw<AccessRequestTriageProjection[]>`
    SELECT * FROM "AccessRequestTriage" WHERE "accessRequestId" = ${accessRequestId} FOR UPDATE
  `;

  await runAccessRequestTriageAfterLockHook({ accessRequestId, operation });

  return lockedAfterCreate[0] ?? null;
}

/** Maps a non-NONE conflict detail onto the event's conflict-evidence columns (see the migration's CHECK matrix). */
function buildConflictEventFields(
  detail: InvitationConflictDetail,
): Partial<Prisma.AccessRequestTriageEventUncheckedCreateInput> {
  switch (detail.type) {
    case "ACTIVE_PENDING_INVITATION":
      return { conflictInvitationId: detail.invitationId };
    case "ALREADY_ACCEPTED":
      return { conflictInvitationId: detail.invitationId };
    case "EXISTING_PARTICIPANT_REISSUE":
      return {
        conflictParticipantId: detail.participantId,
        conflictParticipantIdSnapshots: [detail.participantId],
      };
    case "IDENTITY_AMBIGUOUS":
      return { conflictParticipantIdSnapshots: detail.participantIds };
    case "EXISTING_ALLIANCE_ACCESS":
      return {
        conflictUserId: detail.userId,
        conflictUserIdSnapshot: detail.userId,
        conflictUserEmail: detail.userEmail,
        conflictUserDisplayName: detail.userDisplayName,
        conflictAllianceId: detail.allianceId,
        conflictAllianceIdSnapshot: detail.allianceId,
        conflictAllianceName: detail.allianceName,
        conflictMembershipCount: detail.membershipCount,
      };
  }
}

/** Same evidence, shaped for an AccessRequestTriage projection update (plain scalar FKs, not `connect`). */
function buildConflictProjectionFields(
  detail: Extract<InvitationConflictDetail, { type: "EXISTING_ALLIANCE_ACCESS" }>,
): Partial<Prisma.AccessRequestTriageUncheckedUpdateInput> {
  return {
    conflictUserId: detail.userId,
    conflictUserIdSnapshot: detail.userId,
    conflictUserEmail: detail.userEmail,
    conflictUserDisplayName: detail.userDisplayName,
    conflictAllianceId: detail.allianceId,
    conflictAllianceIdSnapshot: detail.allianceId,
    conflictAllianceName: detail.allianceName,
    conflictMembershipCount: detail.membershipCount,
  };
}

const CLEARED_CONFLICT_PROJECTION_FIELDS: Partial<Prisma.AccessRequestTriageUncheckedUpdateInput> = {
  conflictUserId: null,
  conflictUserIdSnapshot: null,
  conflictUserEmail: null,
  conflictUserDisplayName: null,
  conflictAllianceId: null,
  conflictAllianceIdSnapshot: null,
  conflictAllianceName: null,
  conflictMembershipCount: null,
};

function findExistingAllianceAccessDetail(
  all: InvitationConflictDetail[],
): Extract<InvitationConflictDetail, { type: "EXISTING_ALLIANCE_ACCESS" }> | null {
  return (
    (all.find((d) => d.type === "EXISTING_ALLIANCE_ACCESS") as
      | Extract<InvitationConflictDetail, { type: "EXISTING_ALLIANCE_ACCESS" }>
      | undefined) ?? null
  );
}

/**
 * Append an operator note to an AccessRequest's decision history. Does not
 * change `status` (previousStatus = nextStatus) and is not revision-gated —
 * unlike decline/resolve/reopen, adding a note never overwrites another
 * operator's decision, so there is nothing to protect against staleness for.
 */
export async function addAccessRequestNote(
  accessRequestId: string,
  actorUserId: string,
  noteText: string,
): Promise<AccessRequestTriageActionResult> {
  const validation = validateBoundedText(noteText, { min: NOTE_MIN, max: NOTE_MAX, label: "Note" });
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION", message: validation.message };
  }

  return prisma.$transaction(async (tx) => {
    const exists = await tx.accessRequest.findUnique({
      where: { id: accessRequestId },
      select: { id: true },
    });
    if (!exists) {
      return { ok: false, code: "NOT_FOUND" };
    }

    const actor = await resolveActor(tx, actorUserId);
    if (!actor) {
      return { ok: false, code: "VALIDATION", message: "Acting user not found" };
    }

    const current = await ensureAccessRequestTriageLocked(tx, accessRequestId, "note");
    if (!current) {
      throw new Error(`Failed to lock AccessRequestTriage projection for ${accessRequestId}`);
    }

    const now = new Date();
    await tx.accessRequestTriageEvent.create({
      data: {
        accessRequestId,
        eventType: "NOTE_ADDED",
        // NOTE_ADDED is a non-transition event — previousStatus/nextStatus
        // are NULL (not a same-value pair) so history consumers can tell a
        // real state transition from a note by the event shape itself,
        // not by convention (#177 review).
        previousStatus: null,
        nextStatus: null,
        noteText: validation.value,
        actorUserId,
        actorEmail: actor.email,
        actorDisplayName: actor.displayName,
        createdAt: now,
      },
    });

    // `currentReason` reflects the CURRENT decision (why this request is
    // DECLINED/RESOLVED_EXISTING_ACCESS right now) — not the latest event's
    // text. A note must never overwrite that decision reason, and must not
    // populate currentReason while PENDING either. Only lastEvent* advances.
    const updated = await tx.accessRequestTriage.update({
      where: { accessRequestId },
      data: {
        lastEventAt: now,
        lastEventActorEmail: actor.email,
        lastEventActorDisplayName: actor.displayName,
      },
    });

    return { ok: true, projection: toProjection(updated) };
  });
}

/** Decline a pending AccessRequest. Only valid from PENDING. */
export async function declineAccessRequest(
  accessRequestId: string,
  actorUserId: string,
  reason: string,
  lastSeenStateRevision: number,
): Promise<AccessRequestTriageActionResult> {
  const validation = validateBoundedText(reason, { min: REASON_MIN, max: REASON_MAX, label: "Decline reason" });
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION", message: validation.message };
  }

  return prisma.$transaction(async (tx) => {
    const exists = await tx.accessRequest.findUnique({
      where: { id: accessRequestId },
      select: { id: true },
    });
    if (!exists) {
      return { ok: false, code: "NOT_FOUND" };
    }

    const actor = await resolveActor(tx, actorUserId);
    if (!actor) {
      return { ok: false, code: "VALIDATION", message: "Acting user not found" };
    }

    const current = await ensureAccessRequestTriageLocked(tx, accessRequestId, "stateChange");
    if (!current) {
      throw new Error(`Failed to lock AccessRequestTriage projection for ${accessRequestId}`);
    }

    if (current.status !== "PENDING") {
      return {
        ok: false,
        code: "VALIDATION",
        message: `Only pending requests can be declined (current status: ${current.status})`,
      };
    }

    if (lastSeenStateRevision !== current.stateRevision) {
      return { ok: false, code: "STALE_CONFLICT", conflict: toProjection(current) };
    }

    const now = new Date();
    await tx.accessRequestTriageEvent.create({
      data: {
        accessRequestId,
        eventType: "DECLINED",
        previousStatus: "PENDING",
        nextStatus: "DECLINED",
        declineReason: validation.value,
        actorUserId,
        actorEmail: actor.email,
        actorDisplayName: actor.displayName,
        createdAt: now,
      },
    });

    const updated = await tx.accessRequestTriage.update({
      where: { accessRequestId },
      data: {
        status: "DECLINED",
        currentReason: truncateForProjection(validation.value, PROJECTION_REASON_MAX),
        stateRevision: current.stateRevision + 1,
        lastEventAt: now,
        lastEventActorEmail: actor.email,
        lastEventActorDisplayName: actor.displayName,
        lastStateChangeAt: now,
        lastStateChangeActorEmail: actor.email,
        lastStateChangeActorDisplayName: actor.displayName,
      },
    });

    return { ok: true, projection: toProjection(updated) };
  });
}

/**
 * Resolve a pending AccessRequest as "already has access" — no invitation,
 * no email. The server re-derives the conflict itself rather than trusting
 * the caller's (possibly stale) belief that access exists; if the identity
 * no longer shows EXISTING_ALLIANCE_ACCESS, the action fails validation
 * rather than recording a false decision.
 */
export async function resolveExistingAccess(
  accessRequestId: string,
  actorUserId: string,
  reason: string,
  lastSeenStateRevision: number,
): Promise<AccessRequestTriageActionResult> {
  const validation = validateBoundedText(reason, { min: REASON_MIN, max: REASON_MAX, label: "Resolution reason" });
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION", message: validation.message };
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.accessRequest.findUnique({
      where: { id: accessRequestId },
      select: { id: true, email: true },
    });
    if (!request) {
      return { ok: false, code: "NOT_FOUND" };
    }

    const actor = await resolveActor(tx, actorUserId);
    if (!actor) {
      return { ok: false, code: "VALIDATION", message: "Acting user not found" };
    }

    const current = await ensureAccessRequestTriageLocked(tx, accessRequestId, "stateChange");
    if (!current) {
      throw new Error(`Failed to lock AccessRequestTriage projection for ${accessRequestId}`);
    }

    if (current.status !== "PENDING") {
      return {
        ok: false,
        code: "VALIDATION",
        message: `Only pending requests can be resolved (current status: ${current.status})`,
      };
    }

    if (lastSeenStateRevision !== current.stateRevision) {
      return { ok: false, code: "STALE_CONFLICT", conflict: toProjection(current) };
    }

    const resolution = await resolveInvitationConflict(tx, request.email);
    const accessDetail = findExistingAllianceAccessDetail(resolution.all);
    if (!accessDetail) {
      return {
        ok: false,
        code: "VALIDATION",
        message:
          "This identity no longer shows existing alliance access — refresh the request before resolving it",
      };
    }

    const now = new Date();
    await tx.accessRequestTriageEvent.create({
      data: {
        accessRequestId,
        eventType: "RESOLVED_EXISTING_ACCESS",
        previousStatus: "PENDING",
        nextStatus: "RESOLVED_EXISTING_ACCESS",
        resolutionReason: validation.value,
        ...buildConflictEventFields(accessDetail),
        actorUserId,
        actorEmail: actor.email,
        actorDisplayName: actor.displayName,
        createdAt: now,
      },
    });

    const updated = await tx.accessRequestTriage.update({
      where: { accessRequestId },
      data: {
        status: "RESOLVED_EXISTING_ACCESS",
        currentReason: truncateForProjection(validation.value, PROJECTION_REASON_MAX),
        ...buildConflictProjectionFields(accessDetail),
        stateRevision: current.stateRevision + 1,
        lastEventAt: now,
        lastEventActorEmail: actor.email,
        lastEventActorDisplayName: actor.displayName,
        lastStateChangeAt: now,
        lastStateChangeActorEmail: actor.email,
        lastStateChangeActorDisplayName: actor.displayName,
      },
    });

    return { ok: true, projection: toProjection(updated) };
  });
}

/**
 * Reopen a DECLINED or RESOLVED_EXISTING_ACCESS request back to PENDING.
 *
 * - DECLINED → PENDING is always allowed given a reason (declining was an
 *   operator judgment call, not a fact to re-verify).
 * - RESOLVED_EXISTING_ACCESS → PENDING re-derives the EXISTING_ALLIANCE_ACCESS
 *   evidence first. If access is genuinely gone (or the identity match was
 *   wrong), the reopen proceeds normally. If access still exists — even at a
 *   different alliance — the reopen is DENIED: the resolved state is
 *   retained, but the evidence is refreshed and the revision bumped (so any
 *   UI holding the old evidence is forced to refetch), and an attributable
 *   NOTE_ADDED event records why reopening was refused.
 * - INVITED is irreversible — use resend/reissue on the linked invitation.
 */
export async function reopenAccessRequest(
  accessRequestId: string,
  actorUserId: string,
  reason: string,
  lastSeenStateRevision: number,
): Promise<AccessRequestTriageActionResult> {
  const validation = validateBoundedText(reason, { min: REASON_MIN, max: REASON_MAX, label: "Reopen reason" });
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION", message: validation.message };
  }

  return prisma.$transaction(async (tx) => {
    const request = await tx.accessRequest.findUnique({
      where: { id: accessRequestId },
      select: { id: true, email: true },
    });
    if (!request) {
      return { ok: false, code: "NOT_FOUND" };
    }

    const actor = await resolveActor(tx, actorUserId);
    if (!actor) {
      return { ok: false, code: "VALIDATION", message: "Acting user not found" };
    }

    const current = await ensureAccessRequestTriageLocked(tx, accessRequestId, "stateChange");
    if (!current) {
      throw new Error(`Failed to lock AccessRequestTriage projection for ${accessRequestId}`);
    }

    if (current.status === "PENDING") {
      return { ok: false, code: "VALIDATION", message: "This request is already pending" };
    }
    if (current.status === "INVITED") {
      return {
        ok: false,
        code: "VALIDATION",
        message:
          "An invited request can't be reopened — use resend or reissue on the linked invitation instead",
      };
    }

    if (lastSeenStateRevision !== current.stateRevision) {
      return { ok: false, code: "STALE_CONFLICT", conflict: toProjection(current) };
    }

    const now = new Date();

    if (current.status === "DECLINED") {
      await tx.accessRequestTriageEvent.create({
        data: {
          accessRequestId,
          eventType: "REOPENED",
          previousStatus: "DECLINED",
          nextStatus: "PENDING",
          reopenReason: validation.value,
          actorUserId,
          actorEmail: actor.email,
          actorDisplayName: actor.displayName,
          createdAt: now,
        },
      });

      const updated = await tx.accessRequestTriage.update({
        where: { accessRequestId },
        data: {
          status: "PENDING",
          // `currentReason` is the current DECISION reason (why this
          // request is declined/resolved), not the reopen reason — a
          // successful reopen has no current decision anymore, so it clears
          // rather than inheriting the reopen text (#177 review).
          currentReason: null,
          stateRevision: current.stateRevision + 1,
          lastEventAt: now,
          lastEventActorEmail: actor.email,
          lastEventActorDisplayName: actor.displayName,
          lastStateChangeAt: now,
          lastStateChangeActorEmail: actor.email,
          lastStateChangeActorDisplayName: actor.displayName,
        },
      });

      return { ok: true, projection: toProjection(updated) };
    }

    // current.status === "RESOLVED_EXISTING_ACCESS": re-derive access before
    // deciding whether reopening is safe.
    const resolution = await resolveInvitationConflict(tx, request.email);
    const accessDetail = findExistingAllianceAccessDetail(resolution.all);

    if (!accessDetail) {
      await tx.accessRequestTriageEvent.create({
        data: {
          accessRequestId,
          eventType: "REOPENED",
          previousStatus: "RESOLVED_EXISTING_ACCESS",
          nextStatus: "PENDING",
          reopenReason: validation.value,
          actorUserId,
          actorEmail: actor.email,
          actorDisplayName: actor.displayName,
          createdAt: now,
        },
      });

      const updated = await tx.accessRequestTriage.update({
        where: { accessRequestId },
        data: {
          status: "PENDING",
          // Same rationale as the DECLINED reopen path above: the reopen
          // reason is not a current decision reason.
          currentReason: null,
          ...CLEARED_CONFLICT_PROJECTION_FIELDS,
          stateRevision: current.stateRevision + 1,
          lastEventAt: now,
          lastEventActorEmail: actor.email,
          lastEventActorDisplayName: actor.displayName,
          lastStateChangeAt: now,
          lastStateChangeActorEmail: actor.email,
          lastStateChangeActorDisplayName: actor.displayName,
        },
      });

      return { ok: true, projection: toProjection(updated) };
    }

    // Access still exists — deny the reopen, but refresh the evidence and
    // record an attributable note explaining why (#177 review requirement).
    const deniedMessage = `Reopen denied: this identity still shows existing alliance access (${accessDetail.allianceName}).`;
    const deniedNote = truncateForProjection(
      `${deniedMessage} Requested reason: ${validation.value}`,
      NOTE_MAX,
    );

    await tx.accessRequestTriageEvent.create({
      data: {
        accessRequestId,
        eventType: "NOTE_ADDED",
        // Non-transition event — see the rationale on the other NOTE_ADDED
        // writer above.
        previousStatus: null,
        nextStatus: null,
        noteText: deniedNote,
        ...buildConflictEventFields(accessDetail),
        actorUserId,
        actorEmail: actor.email,
        actorDisplayName: actor.displayName,
        createdAt: now,
      },
    });

    const updated = await tx.accessRequestTriage.update({
      where: { accessRequestId },
      data: {
        ...buildConflictProjectionFields(accessDetail),
        // Refreshed evidence changes the projection's meaning even though
        // status is unchanged, so the revision still advances — any UI
        // holding the stale evidence must refetch (#177 review requirement).
        stateRevision: current.stateRevision + 1,
        lastEventAt: now,
        lastEventActorEmail: actor.email,
        lastEventActorDisplayName: actor.displayName,
      },
    });

    return {
      ok: false,
      code: "REOPEN_DENIED_ACCESS_STILL_EXISTS",
      projection: toProjection(updated),
      message: deniedMessage,
    };
  });
}

async function convertAccessRequestToInvitationWithTx(
  tx: Prisma.TransactionClient,
  accessRequestId: string,
  actorUserId: string,
  betaWave: string,
  lastSeenStateRevision: number,
): Promise<ConvertAccessRequestResult> {
  const request = await tx.accessRequest.findUnique({
    where: { id: accessRequestId },
    select: { id: true, email: true },
  });
  if (!request) {
    return { ok: false, code: "NOT_FOUND" };
  }

  const actor = await resolveActor(tx, actorUserId);
  if (!actor) {
    return { ok: false, code: "VALIDATION", message: "Acting user not found" };
  }

  const current = await ensureAccessRequestTriageLocked(tx, accessRequestId, "convert");
  if (!current) {
    throw new Error(`Failed to lock AccessRequestTriage projection for ${accessRequestId}`);
  }

  // Idempotent: a retried/double-clicked/concurrent conversion of an
  // already-INVITED request returns the SAME invitation. No new event is
  // written (the original INVITED event already recorded this) and the
  // caller must not attempt delivery again.
  if (current.status === "INVITED") {
    if (!current.linkedInvitationId) {
      throw new Error(
        `AccessRequestTriage ${accessRequestId} is INVITED but has no linkedInvitationId`,
      );
    }
    const existingInvitation: BetaInvitation | null = await tx.betaInvitation.findUnique({
      where: { id: current.linkedInvitationId },
    });
    if (!existingInvitation) {
      throw new Error(
        `Linked invitation ${current.linkedInvitationId} not found for AccessRequestTriage ${accessRequestId}`,
      );
    }
    return {
      ok: true,
      projection: toProjection(current),
      createdNow: false,
      shouldDeliver: false,
      ...buildInvitationResult(existingInvitation),
    };
  }

  if (current.status !== "PENDING") {
    return {
      ok: false,
      code: "VALIDATION",
      message: `Only pending requests can be converted (current status: ${current.status})`,
    };
  }

  // Optimistic concurrency: the operator approved a specific PENDING
  // revision they saw. Status alone can't detect e.g. decline -> reopen
  // (status is PENDING again but the revision has moved) — without this
  // check a stale Approve could silently convert a request the operator
  // never actually reviewed at its current revision (#177 review).
  if (lastSeenStateRevision !== current.stateRevision) {
    return { ok: false, code: "STALE_CONFLICT", conflict: toProjection(current) };
  }

  try {
    const invitation = await issueBetaInvitationWithTx(tx, request.email, {
      campaign: betaWave,
      issuedByUserId: actorUserId,
    });

    const now = new Date();
    await tx.accessRequestTriageEvent.create({
      data: {
        accessRequestId,
        eventType: "INVITED",
        previousStatus: "PENDING",
        nextStatus: "INVITED",
        betaWave,
        linkedInvitationId: invitation.id,
        actorUserId,
        actorEmail: actor.email,
        actorDisplayName: actor.displayName,
        createdAt: now,
      },
    });

    const updated = await tx.accessRequestTriage.update({
      where: { accessRequestId },
      data: {
        status: "INVITED",
        linkedInvitationId: invitation.id,
        betaWave,
        currentReason: null,
        stateRevision: current.stateRevision + 1,
        lastEventAt: now,
        lastEventActorEmail: actor.email,
        lastEventActorDisplayName: actor.displayName,
        lastStateChangeAt: now,
        lastStateChangeActorEmail: actor.email,
        lastStateChangeActorDisplayName: actor.displayName,
      },
    });

    return {
      ok: true,
      projection: toProjection(updated),
      createdNow: true,
      shouldDeliver: true,
      ...buildInvitationResult(invitation),
    };
  } catch (error) {
    // Only a classified domain conflict may be caught here and turned into a
    // CONVERSION_BLOCKED event. Anything else (Prisma constraint violation,
    // serialization failure, infrastructure error) must roll back and
    // propagate untouched — Postgres may have already aborted this
    // transaction, so attempting to write an event here could itself fail
    // in a confusing way (#177 review requirement).
    if (!(error instanceof BetaInvitationConflictError)) {
      throw error;
    }

    const { primary } = error.resolution;
    const conflictType = toInvitationConflictType(primary);
    const blockedReason = describeInvitationConflict(primary);
    const now = new Date();

    await tx.accessRequestTriageEvent.create({
      data: {
        accessRequestId,
        eventType: "CONVERSION_BLOCKED",
        // Non-transition event — a blocked attempt never changes state, and
        // is recorded as NULL/NULL rather than PENDING/PENDING so the event
        // shape itself (not convention) distinguishes transitions from
        // non-transitions (#177 review).
        previousStatus: null,
        nextStatus: null,
        blockedReason,
        blockedConflictType: conflictType,
        ...buildConflictEventFields(primary),
        actorUserId,
        actorEmail: actor.email,
        actorDisplayName: actor.displayName,
        createdAt: now,
      },
    });

    const updated = await tx.accessRequestTriage.update({
      where: { accessRequestId },
      data: {
        lastEventAt: now,
        lastEventActorEmail: actor.email,
        lastEventActorDisplayName: actor.displayName,
      },
    });

    return {
      ok: false,
      code: "CONVERSION_BLOCKED",
      projection: toProjection(updated),
      conflictType,
      message: blockedReason,
    };
  }
}

/**
 * Approve a pending AccessRequest and convert it into a BetaInvitation.
 *
 * Runs at Serializable isolation (matching issueBetaInvitation) since the
 * underlying conflict check-then-create must be race-free; a serialization
 * failure re-runs the ENTIRE attempt (lock, conflict re-check, and either
 * the invitation-and-INVITED-event write or the CONVERSION_BLOCKED write)
 * from scratch, exactly like issueBetaInvitation's own retry loop.
 *
 * Deliberately does NOT send email — this only creates the invitation and
 * commits triage state atomically. The caller (the platform action layer)
 * must check `shouldDeliver` and, when true, call deliverBetaInvitationEmail
 * itself AFTER this commits. `shouldDeliver: false` on an idempotent
 * re-conversion means "this call did not (re)trigger delivery" — it does
 * NOT mean delivery never happened; see ADR-014.
 *
 * `lastSeenStateRevision` guards against a stale Approve: status alone
 * can't detect e.g. decline -> reopen (status returns to PENDING at a new
 * revision), so a mismatch is checked AFTER the idempotent already-INVITED
 * return (which must keep succeeding regardless of the caller's stale
 * revision) but BEFORE creating anything new.
 */
export async function convertAccessRequestToInvitation(
  accessRequestId: string,
  actorUserId: string,
  betaWave: string,
  lastSeenStateRevision: number,
): Promise<ConvertAccessRequestResult> {
  const validation = validateBoundedText(betaWave, { min: WAVE_MIN, max: WAVE_MAX, label: "Beta wave" });
  if (!validation.ok) {
    return { ok: false, code: "VALIDATION", message: validation.message };
  }

  for (let attempt = 0; attempt < CONVERT_MAX_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        (tx) =>
          convertAccessRequestToInvitationWithTx(
            tx,
            accessRequestId,
            actorUserId,
            validation.value,
            lastSeenStateRevision,
          ),
        { isolationLevel: "Serializable", maxWait: 5000, timeout: 10000 },
      );
    } catch (error) {
      if (isSerializationFailure(error) && attempt < CONVERT_MAX_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to convert access request after retries");
}
