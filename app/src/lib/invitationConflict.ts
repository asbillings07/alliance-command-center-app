import type { Prisma } from "@/app/generated/prisma/client";
import { InvitationConflictType } from "@/app/generated/prisma/enums";
import { normalizeEmail } from "./email/normalize";
import { findParticipantIdentityCandidates } from "./betaParticipantIdentity";

/**
 * Authoritative, single-source-of-truth classification of why an email
 * cannot be issued a beta invitation right now (#177).
 *
 * This module owns the *facts* (via {@link gatherInvitationConflictFacts},
 * which reads the database) and the *decision* (via
 * {@link classifyInvitationConflict}, a pure function over those facts)
 * separately, so:
 *   - `issueBetaInvitationWithTx` (betaInvitation.ts) and
 *     `convertAccessRequestToInvitation` (accessRequestTriage.ts) share one
 *     precedence rule instead of two hand-maintained copies;
 *   - a later batched read-model (accessRequestInbox.ts, PR 2) can gather
 *     facts more efficiently for N rows and still run every row through the
 *     exact same `classifyInvitationConflict`, giving scalar and batched call
 *     sites parity by construction rather than by convention.
 */

/** Detail payload for each possible conflict, carrying what the UI/event log needs to explain and act on it. */
export type InvitationConflictDetail =
  | {
      type: "ACTIVE_PENDING_INVITATION";
      invitationId: string;
    }
  | {
      type: "EXISTING_ALLIANCE_ACCESS";
      userId: string;
      userEmail: string;
      userDisplayName: string;
      allianceId: string;
      allianceName: string;
      /** Total number of alliances this user belongs to (>= 1). */
      membershipCount: number;
    }
  | {
      type: "IDENTITY_AMBIGUOUS";
      /** The disagreeing BetaParticipant ids (>= 2), most-recently-known first. */
      participantIds: string[];
    }
  | {
      type: "ALREADY_ACCEPTED";
      invitationId: string;
      participantId: string;
    }
  | {
      type: "EXISTING_PARTICIPANT_REISSUE";
      participantId: string;
    };

export type InvitationConflictResolution =
  | { primary: { type: "NONE" }; all: [] }
  | { primary: InvitationConflictDetail; all: InvitationConflictDetail[] };

/**
 * Thrown by `issueBetaInvitationWithTx` for every conflict this module can
 * classify. Callers (accessRequestTriage.ts's convert flow) must catch only
 * this type before writing a `CONVERSION_BLOCKED` event — any other error
 * (Prisma constraint violation, serialization failure, infrastructure
 * failure) must roll back and propagate untouched.
 */
export class BetaInvitationConflictError extends Error {
  constructor(public readonly resolution: Exclude<InvitationConflictResolution, { primary: { type: "NONE" } }>) {
    super(describeInvitationConflict(resolution.primary));
    this.name = "BetaInvitationConflictError";
  }
}

/** Canonical, user-facing text for a single conflict — shared by thrown errors and CONVERSION_BLOCKED events. */
export function describeInvitationConflict(detail: InvitationConflictDetail): string {
  switch (detail.type) {
    case "ACTIVE_PENDING_INVITATION":
      return "This person already has an active invitation — resend it instead of creating a new one";
    case "EXISTING_ALLIANCE_ACCESS":
      return "This user already has access to an alliance";
    case "IDENTITY_AMBIGUOUS":
      return "This person's identity is ambiguous across existing beta records — resolve it manually before converting";
    case "ALREADY_ACCEPTED":
      return "This person has already accepted a beta invitation";
    case "EXISTING_PARTICIPANT_REISSUE":
      return "This person is already a beta participant — use Reissue on their latest attempt instead of creating a new invitation";
  }
}

/** Raw facts gathered from the database for one email/user identity. Pure input to {@link classifyInvitationConflict}. */
export type InvitationConflictFacts = {
  pendingInvitation: { id: string } | null;
  existingUser: { id: string; email: string; displayName: string } | null;
  /** All alliance memberships for `existingUser`, earliest first. Empty when no `existingUser` or no memberships. */
  memberships: Array<{ allianceId: string; allianceName: string }>;
  /** True when the resolved BetaParticipant itself carries a prior merge's ambiguity flag. */
  resolvedParticipantIdentityAmbiguous: boolean;
  /** Both candidate participant lookups — may disagree (see IDENTITY_AMBIGUOUS). */
  participantCandidates: {
    fromEmailHistory: { id: string; identityAmbiguous: boolean } | null;
    fromUser: { id: string; identityAmbiguous: boolean } | null;
  };
  /** The resolved participant's latest invitation attempt, when a participant was found unambiguously. */
  latestInvitationForParticipant: {
    id: string;
    acceptedAt: Date | null;
  } | null;
};

const LATEST_ATTEMPT_ORDER: Prisma.BetaInvitationOrderByWithRelationInput[] = [
  { issuedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

/**
 * Gather every fact `classifyInvitationConflict` needs for one email, inside
 * the caller's transaction. Scalar (single-identity) — see the module intro
 * for the planned batched sibling.
 */
export async function gatherInvitationConflictFacts(
  tx: Prisma.TransactionClient,
  email: string,
): Promise<InvitationConflictFacts> {
  const normalizedEmail = normalizeEmail(email);
  const now = new Date();

  const pendingInvitation = await tx.betaInvitation.findFirst({
    where: {
      email: normalizedEmail,
      acceptedAt: null,
      revokedAt: null,
      expiresAt: { gte: now },
    },
    orderBy: { issuedAt: "desc" },
    select: { id: true },
  });

  const existingUser = await tx.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true, email: true, displayName: true },
  });

  let memberships: Array<{ allianceId: string; allianceName: string }> = [];
  if (existingUser) {
    const rows = await tx.allianceMembership.findMany({
      where: { userId: existingUser.id },
      orderBy: { createdAt: "asc" },
      select: { allianceId: true, alliance: { select: { name: true } } },
    });
    memberships = rows.map((r) => ({ allianceId: r.allianceId, allianceName: r.alliance.name }));
  }

  const participantCandidates = await findParticipantIdentityCandidates(
    tx,
    normalizedEmail,
    existingUser?.id ?? null,
  );

  const agreedParticipantId =
    participantCandidates.fromEmailHistory &&
    participantCandidates.fromUser &&
    participantCandidates.fromEmailHistory.id === participantCandidates.fromUser.id
      ? participantCandidates.fromEmailHistory.id
      : (participantCandidates.fromEmailHistory ?? participantCandidates.fromUser)?.id ?? null;

  const disagree = Boolean(
    participantCandidates.fromEmailHistory &&
      participantCandidates.fromUser &&
      participantCandidates.fromEmailHistory.id !== participantCandidates.fromUser.id,
  );

  const resolvedParticipantIdentityAmbiguous =
    disagree ||
    Boolean(participantCandidates.fromEmailHistory?.identityAmbiguous) ||
    Boolean(participantCandidates.fromUser?.identityAmbiguous);

  let latestInvitationForParticipant: { id: string; acceptedAt: Date | null } | null = null;
  if (agreedParticipantId && !disagree) {
    latestInvitationForParticipant = await tx.betaInvitation.findFirst({
      where: { participantId: agreedParticipantId },
      orderBy: LATEST_ATTEMPT_ORDER,
      select: { id: true, acceptedAt: true },
    });
  }

  return {
    pendingInvitation,
    existingUser,
    memberships,
    resolvedParticipantIdentityAmbiguous,
    participantCandidates,
    latestInvitationForParticipant,
  };
}

/**
 * Pure classification over already-gathered facts. Precedence (highest
 * first), matching the pre-#177 production order for the first two checks
 * and splitting the former single "already a beta participant" branch into
 * three distinct, actionable outcomes:
 *
 *   1. ACTIVE_PENDING_INVITATION — resend, don't re-invite.
 *   2. EXISTING_ALLIANCE_ACCESS — no invitation is needed at all; resolve.
 *   3. IDENTITY_AMBIGUOUS — the two identity lookups disagree (or a prior
 *      merge already flagged the participant); needs manual review.
 *   4. ALREADY_ACCEPTED — the participant's latest attempt was accepted but
 *      they have no alliance yet (otherwise (2) would have already fired).
 *   5. EXISTING_PARTICIPANT_REISSUE — latest attempt is terminal
 *      (expired/revoked); use Reissue.
 *   6. NONE — safe to issue.
 */
export function classifyInvitationConflict(
  facts: InvitationConflictFacts,
): InvitationConflictResolution {
  const all: InvitationConflictDetail[] = [];

  if (facts.pendingInvitation) {
    all.push({ type: "ACTIVE_PENDING_INVITATION", invitationId: facts.pendingInvitation.id });
  }

  if (facts.existingUser && facts.memberships.length > 0) {
    const first = facts.memberships[0]!;
    all.push({
      type: "EXISTING_ALLIANCE_ACCESS",
      userId: facts.existingUser.id,
      userEmail: facts.existingUser.email,
      userDisplayName: facts.existingUser.displayName,
      allianceId: first.allianceId,
      allianceName: first.allianceName,
      membershipCount: facts.memberships.length,
    });
  }

  if (facts.resolvedParticipantIdentityAmbiguous) {
    const participantIds = Array.from(
      new Set(
        [facts.participantCandidates.fromEmailHistory?.id, facts.participantCandidates.fromUser?.id].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    );
    all.push({ type: "IDENTITY_AMBIGUOUS", participantIds });
  } else if (facts.latestInvitationForParticipant) {
    if (facts.latestInvitationForParticipant.acceptedAt) {
      all.push({
        type: "ALREADY_ACCEPTED",
        invitationId: facts.latestInvitationForParticipant.id,
        participantId:
          facts.participantCandidates.fromEmailHistory?.id ?? facts.participantCandidates.fromUser!.id,
      });
    } else {
      all.push({
        type: "EXISTING_PARTICIPANT_REISSUE",
        participantId:
          facts.participantCandidates.fromEmailHistory?.id ?? facts.participantCandidates.fromUser!.id,
      });
    }
  }

  if (all.length === 0) {
    return { primary: { type: "NONE" }, all: [] };
  }

  const precedence: InvitationConflictDetail["type"][] = [
    "ACTIVE_PENDING_INVITATION",
    "EXISTING_ALLIANCE_ACCESS",
    "IDENTITY_AMBIGUOUS",
    "ALREADY_ACCEPTED",
    "EXISTING_PARTICIPANT_REISSUE",
  ];
  const primary = all.slice().sort((a, b) => precedence.indexOf(a.type) - precedence.indexOf(b.type))[0]!;

  return { primary, all };
}

/** Map an {@link InvitationConflictDetail} onto the persisted enum for events/projections. */
export function toInvitationConflictType(
  detail: InvitationConflictDetail | { type: "NONE" },
): InvitationConflictType {
  switch (detail.type) {
    case "ACTIVE_PENDING_INVITATION":
      return InvitationConflictType.ACTIVE_PENDING_INVITATION;
    case "EXISTING_ALLIANCE_ACCESS":
      return InvitationConflictType.EXISTING_ALLIANCE_ACCESS;
    case "IDENTITY_AMBIGUOUS":
      return InvitationConflictType.IDENTITY_AMBIGUOUS;
    case "ALREADY_ACCEPTED":
      return InvitationConflictType.ALREADY_ACCEPTED;
    case "EXISTING_PARTICIPANT_REISSUE":
      return InvitationConflictType.EXISTING_PARTICIPANT_REISSUE;
    case "NONE":
      return InvitationConflictType.NONE;
  }
}

/** Convenience: gather + classify in one call, for the common scalar case. */
export async function resolveInvitationConflict(
  tx: Prisma.TransactionClient,
  email: string,
): Promise<InvitationConflictResolution> {
  const facts = await gatherInvitationConflictFacts(tx, email);
  return classifyInvitationConflict(facts);
}
