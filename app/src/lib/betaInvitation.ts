import { randomUUID, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { getRedeemUrl } from "./appUrl";
import type { BetaInvitation } from "@/app/generated/prisma/client";
import type { Prisma } from "@/app/generated/prisma/client";
import { normalizeEmail } from "./email/normalize";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import {
  runBetaInvitationAfterParticipantLockHook,
  runBetaInvitationBeforeParticipantLockHook,
  type BetaInvitationLockOperation,
} from "./betaInvitationTestHooks";
import type { EmailResult, EmailStatus } from "./email/types";
import {
  recordBetaInvitationDeliveryAttempt,
  resolveDeliveryActorSnapshot,
  type BetaInvitationDeliveryTriggerInput,
} from "./betaInvitationDelivery";

function generateBetaCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const len = chars.length;
  const limit = 256 - (256 % len);

  const randomChar = (): string => {
    let byte: number;
    do {
      byte = randomBytes(1)[0];
    } while (byte >= limit);
    return chars[byte % len];
  };

  const segment = () => Array.from({ length: 3 }, randomChar).join("");
  return `${segment()}-${segment()}`;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

const ACCEPT_MAX_RETRIES = 3;

const ACCEPT_TRANSACTION_OPTIONS = {
  isolationLevel: "Serializable" as const,
  maxWait: 5000,
  timeout: 10000,
};

/** Resend claim lease — revoke must fail closed while a live claim exists. */
export const BETA_RESEND_CLAIM_LEASE_MS = 30_000;

/**
 * Email provider timeout must stay strictly below {@link BETA_RESEND_CLAIM_LEASE_MS}
 * so a send cannot outlive its own claim lease (#174).
 */
export const BETA_EMAIL_PROVIDER_TIMEOUT_MS = 20_000;

const PARTICIPANT_MUTATION_TRANSACTION_OPTIONS = {
  isolationLevel: "ReadCommitted" as const,
  maxWait: 5000,
  timeout: 10000,
};

const LATEST_ATTEMPT_ORDER: Prisma.BetaInvitationOrderByWithRelationInput[] = [
  { issuedAt: "desc" },
  { createdAt: "desc" },
  { id: "desc" },
];

function assertResendTimeoutInvariant(): void {
  if (BETA_EMAIL_PROVIDER_TIMEOUT_MS >= BETA_RESEND_CLAIM_LEASE_MS) {
    throw new Error(
      "BETA_EMAIL_PROVIDER_TIMEOUT_MS must be strictly less than BETA_RESEND_CLAIM_LEASE_MS",
    );
  }
}

assertResendTimeoutInvariant();

function resendClaimEligibilityCutoff(now: Date): Date {
  return new Date(now.getTime() - BETA_RESEND_CLAIM_LEASE_MS);
}

async function findLatestInvitationForParticipant(
  db: Prisma.TransactionClient | typeof prisma,
  participantId: string,
) {
  return db.betaInvitation.findFirst({
    where: { participantId },
    orderBy: LATEST_ATTEMPT_ORDER,
  });
}

/**
 * Participant-scoped serialization for claim, revoke, and reissue (#174).
 */
async function acquireBetaParticipantMutationLock(
  tx: Prisma.TransactionClient,
  participantId: string,
  operation: BetaInvitationLockOperation,
): Promise<void> {
  await runBetaInvitationBeforeParticipantLockHook({
    participantId,
    operation,
  });
  await tx.$executeRaw`
    SELECT id FROM "BetaParticipant" WHERE id = ${participantId} FOR UPDATE
  `;
  await runBetaInvitationAfterParticipantLockHook({
    participantId,
    operation,
  });
}

/**
 * Returns true when the latest attempt is expired or revoked (eligible for reissue).
 */
export function isReissueEligibleTerminalInvitation(
  invitation: BetaInvitation,
  now = new Date(),
): boolean {
  if (invitation.acceptedAt) {
    return false;
  }
  if (invitation.revokedAt) {
    return true;
  }
  return invitation.expiresAt < now;
}

function isReissueUniqueViolation(error: unknown): boolean {
  if (!(error instanceof PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("reissuedFromInvitationId");
  }
  if (typeof target === "string") {
    return target.includes("reissuedFromInvitationId");
  }
  return false;
}

/**
 * Ensures an invitation is the participant's latest attempt (immutable history guard).
 */
export async function assertInvitationIsLatestAttempt(
  invitationId: string,
  db: Prisma.TransactionClient | typeof prisma = prisma,
): Promise<BetaInvitation> {
  const invitation = await db.betaInvitation.findUnique({
    where: { id: invitationId },
  });

  if (!invitation) {
    throw new Error("Beta invitation not found");
  }

  const latest = await findLatestInvitationForParticipant(
    db,
    invitation.participantId,
  );

  if (!latest || latest.id !== invitationId) {
    throw new Error(LATEST_ATTEMPT_ONLY_ERROR);
  }

  return invitation;
}

/**
 * Postgres serialization failure (40001 / Prisma P2034).
 */
function isSerializationFailure(error: unknown): boolean {
  if (
    error instanceof PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }
  return (
    error instanceof Error &&
    "code" in error &&
    (error as { code?: string }).code === "P2034"
  );
}

/**
 * Unique violation on BetaParticipant.userId (23505 / Prisma P2002).
 */
function isBetaParticipantUserIdUniqueViolation(error: unknown): boolean {
  if (!(error instanceof PrismaClientKnownRequestError) || error.code !== "P2002") {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes("userId");
  }
  if (typeof target === "string") {
    return target.includes("userId");
  }
  return false;
}

export type IssueBetaInvitationResult = {
  invitation: BetaInvitation;
  inviteUrl: string;
  inviteCode: string;
};

/**
 * Determine whether an invitation is currently pending.
 * Pending = not accepted, not revoked, and not expired.
 *
 * This is the single source of truth for the "pending" business rule.
 */
export function isPendingInvitation(
  invitation: BetaInvitation,
  now: Date = new Date(),
): boolean {
  // Expiry boundary matches the rest of the module: an invitation is expired
  // only when expiresAt < now (validateBetaToken/validateBetaCode), so it is
  // still valid — and therefore pending — when expiresAt >= now.
  return (
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt >= now
  );
}

const LATEST_ATTEMPT_ONLY_ERROR =
  "This action applies only to the participant's latest invitation attempt";

/**
 * Atomic resend-claim update: succeeds only when the row is still the
 * participant's latest pending attempt at commit time (#174).
 */
async function atomicClaimResendIfLatestAttempt(
  db: Prisma.TransactionClient | typeof prisma,
  invitationId: string,
  participantId: string,
  claimId: string,
  now: Date,
): Promise<number> {
  const claimTimeoutCutoff = resendClaimEligibilityCutoff(now);
  return Number(
    await db.$executeRaw`
      UPDATE "BetaInvitation" AS bi
      SET
        "resendClaimedAt" = ${now},
        "resendClaimId" = ${claimId},
        "updatedAt" = ${now}
      WHERE bi.id = ${invitationId}
        AND bi."participantId" = ${participantId}
        AND bi."acceptedAt" IS NULL
        AND bi."revokedAt" IS NULL
        AND bi."expiresAt" >= ${now}
        AND (
          bi."resendClaimedAt" IS NULL
          OR bi."resendClaimedAt" < ${claimTimeoutCutoff}
        )
        AND bi.id = (
          SELECT bi2.id
          FROM "BetaInvitation" bi2
          WHERE bi2."participantId" = ${participantId}
          ORDER BY bi2."issuedAt" DESC, bi2."createdAt" DESC, bi2.id DESC
          LIMIT 1
        )
    `,
  );
}

/**
 * Atomic revoke update: succeeds only when the row is still the participant's
 * latest pending attempt at commit time (#174).
 */
async function atomicRevokeIfLatestAttempt(
  db: Prisma.TransactionClient | typeof prisma,
  invitationId: string,
  participantId: string,
  revokedByUserId: string | null,
  now: Date,
): Promise<number> {
  const claimTimeoutCutoff = resendClaimEligibilityCutoff(now);
  return Number(
    await db.$executeRaw`
      UPDATE "BetaInvitation" AS bi
      SET
        "revokedAt" = ${now},
        "revokedByUserId" = ${revokedByUserId},
        "updatedAt" = ${now}
      WHERE bi.id = ${invitationId}
        AND bi."participantId" = ${participantId}
        AND bi."acceptedAt" IS NULL
        AND bi."revokedAt" IS NULL
        AND bi."expiresAt" >= ${now}
        AND (
          bi."resendClaimedAt" IS NULL
          OR bi."resendClaimedAt" < ${claimTimeoutCutoff}
        )
        AND bi.id = (
          SELECT bi2.id
          FROM "BetaInvitation" bi2
          WHERE bi2."participantId" = ${participantId}
          ORDER BY bi2."issuedAt" DESC, bi2."createdAt" DESC, bi2.id DESC
          LIMIT 1
        )
    `,
  );
}

async function throwResendClaimFailure(
  db: Prisma.TransactionClient | typeof prisma,
  invitationId: string,
  participantId: string,
  now: Date,
): Promise<never> {
  const [current, latest] = await Promise.all([
    db.betaInvitation.findUnique({ where: { id: invitationId } }),
    findLatestInvitationForParticipant(db, participantId),
  ]);

  if (!current) {
    throw new Error("Beta invitation not found");
  }

  if (!latest || latest.id !== invitationId) {
    throw new Error(LATEST_ATTEMPT_ONLY_ERROR);
  }

  if (current.revokedAt) {
    throw new Error("This beta invitation has been revoked");
  }

  if (current.expiresAt < now) {
    throw new Error("This beta invitation has expired");
  }

  const claimTimeoutCutoff = resendClaimEligibilityCutoff(now);
  if (
    current.resendClaimedAt &&
    current.resendClaimedAt >= claimTimeoutCutoff
  ) {
    throw new Error(
      "A delivery attempt is already in progress for this invitation — try again shortly",
    );
  }

  throw new Error("Only pending invitations can be resent");
}

async function throwRevokeFailure(
  db: Prisma.TransactionClient | typeof prisma,
  invitationId: string,
  participantId: string,
  now: Date,
): Promise<never> {
  const [invitation, latest] = await Promise.all([
    db.betaInvitation.findUnique({ where: { id: invitationId } }),
    findLatestInvitationForParticipant(db, participantId),
  ]);

  if (!invitation) {
    throw new Error("Beta invitation not found");
  }

  if (!latest || latest.id !== invitationId) {
    throw new Error(LATEST_ATTEMPT_ONLY_ERROR);
  }

  if (invitation.acceptedAt) {
    throw new Error("Cannot revoke an accepted invitation");
  }

  if (invitation.revokedAt) {
    throw new Error("Invitation has already been revoked");
  }

  if (invitation.expiresAt < now) {
    throw new Error("Cannot revoke an expired invitation");
  }

  const claimTimeoutCutoff = resendClaimEligibilityCutoff(now);
  if (
    invitation.resendClaimedAt &&
    invitation.resendClaimedAt >= claimTimeoutCutoff
  ) {
    throw new Error(
      "A delivery attempt is in progress for this invitation — try again shortly",
    );
  }

  throw new Error("Failed to revoke invitation");
}

/**
 * Build the "pending invitation" query filter for an email.
 *
 * Single source of truth for the pending rule at the query layer, mirroring
 * isPendingInvitation() for in-memory records.
 */
function pendingInvitationWhere(normalizedEmail: string, now: Date) {
  return {
    email: normalizedEmail,
    acceptedAt: null,
    revokedAt: null,
    // gte mirrors the module's expiry semantics (expired only when expiresAt < now)
    // and matches getInvitationStats, which counts pending with expiresAt >= now.
    expiresAt: { gte: now },
  };
}

/**
 * Get the pending invitation for an email, if one exists.
 *
 * Answers the business question: "Is there a valid, usable invitation
 * for this email right now?" Queries directly for pending state rather
 * than fetching the latest record and evaluating it afterward.
 */
export async function getPendingInvitation(
  email: string
): Promise<BetaInvitation | null> {
  const normalizedEmail = normalizeEmail(email);

  return prisma.betaInvitation.findFirst({
    where: pendingInvitationWhere(normalizedEmail, new Date()),
    orderBy: { issuedAt: "desc" },
  });
}

export type IssueBetaInvitationOptions = {
  notes?: string;
  campaign?: string;
  /** Platform operator who issued the invitation (#174 attribution). */
  issuedByUserId?: string;
};

/**
 * Issue a beta invitation for an email address.
 *
 * BetaInvitation is a history table: every issuance creates a new record,
 * preserving revoked and expired invitations for audit history.
 *
 * Business rules (owned entirely by this service):
 * - Only one pending invitation per email at a time
 * - Cannot invite a user who already has alliance access
 *
 * @param email - The email address to invite
 * @param options - Optional notes and campaign/wave label
 */
export async function issueBetaInvitation(
  email: string,
  options?: IssueBetaInvitationOptions
): Promise<IssueBetaInvitationResult> {
  const normalizedEmail = normalizeEmail(email);

  const now = new Date();
  const token = randomUUID();
  const code = generateBetaCode();

  const issueAttempt = () =>
    prisma.$transaction(
      async (tx) => {
        // Only one pending invitation per email
        const pending = await tx.betaInvitation.findFirst({
          where: pendingInvitationWhere(normalizedEmail, now),
          orderBy: { issuedAt: "desc" },
        });
        if (pending) {
          throw new Error(
            "This person already has an active invitation — resend it instead of creating a new one",
          );
        }

        // Cannot invite a user who already has alliance access
        const existingUser = await tx.user.findUnique({
          where: { email: normalizedEmail },
        });

        if (existingUser) {
          const membership = await tx.allianceMembership.findFirst({
            where: { userId: existingUser.id },
          });

          if (membership) {
            throw new Error("This user already has access to an alliance");
          }
        }

        const existingParticipantId = await findExistingParticipantIdForIdentity(
          tx,
          normalizedEmail,
          existingUser?.id ?? null,
        );
        if (existingParticipantId) {
          throw new Error(
            "This person is already a beta participant — use Reissue on their latest attempt instead of creating a new invitation",
          );
        }

        const participant = await tx.betaParticipant.create({ data: {} });

        return tx.betaInvitation.create({
          data: {
            email: normalizedEmail,
            token,
            code,
            notes: options?.notes?.trim() || null,
            campaign: options?.campaign?.trim() || null,
            expiresAt: addDays(now, 30),
            createdAt: now,
            issuedAt: now,
            participantId: participant.id,
            issuedByUserId: options?.issuedByUserId ?? null,
          },
        });
      },
      { isolationLevel: "Serializable" }
    );

  let invitation: BetaInvitation | null = null;
  for (let attempt = 0; attempt < ACCEPT_MAX_RETRIES; attempt++) {
    try {
      invitation = await issueAttempt();
      break;
    } catch (error) {
      if (isSerializationFailure(error) && attempt < ACCEPT_MAX_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  if (!invitation) {
    throw new Error("Failed to issue beta invitation after retries");
  }

  return buildInvitationResult(invitation);
}

/**
 * Build the invitation result with URL.
 */
function buildInvitationResult(
  invitation: BetaInvitation
): IssueBetaInvitationResult {
  return {
    invitation,
    inviteUrl: getRedeemUrl(invitation.token),
    inviteCode: invitation.code,
  };
}

/**
 * Revoke a beta invitation.
 * Sets revokedAt timestamp to prevent the invitation from being used.
 * Does not delete the invitation, preserving audit history.
 *
 * Uses atomic update to prevent race conditions with in-flight resend claims.
 */
export async function revokeBetaInvitation(
  invitationId: string,
  revokedByUserId?: string,
): Promise<void> {
  const invitation = await prisma.betaInvitation.findUnique({
    where: { id: invitationId },
    select: { id: true, participantId: true },
  });

  if (!invitation) {
    throw new Error("Beta invitation not found");
  }

  await prisma.$transaction(async (tx) => {
    await acquireBetaParticipantMutationLock(
      tx,
      invitation.participantId,
      "revoke",
    );

    const txNow = new Date();
    const result = await atomicRevokeIfLatestAttempt(
      tx,
      invitationId,
      invitation.participantId,
      revokedByUserId ?? null,
      txNow,
    );

    if (result === 0) {
      await throwRevokeFailure(
        tx,
        invitationId,
        invitation.participantId,
        txNow,
      );
    }
  }, PARTICIPANT_MUTATION_TRANSACTION_OPTIONS);
}

export type ReissueBetaInvitationOptions = {
  /** When set, replaces the carried-forward wave from the source attempt. */
  campaign?: string;
};

/**
 * Reissue a beta invitation for an existing participant whose latest attempt
 * is terminal (expired or revoked). Creates a new history row linked via
 * reissuedFromInvitationId; notes are never carried forward (#174).
 */
export async function reissueBetaInvitation(
  participantId: string,
  issuedByUserId: string,
  options?: ReissueBetaInvitationOptions,
): Promise<IssueBetaInvitationResult> {
  const token = randomUUID();
  const code = generateBetaCode();
  const campaignOverrideProvided = options?.campaign !== undefined;

  const reissueAttempt = () =>
    prisma.$transaction(
      async (tx) => {
        await acquireBetaParticipantMutationLock(tx, participantId, "reissue");

        const txNow = new Date();

        const participant = await tx.betaParticipant.findUnique({
          where: { id: participantId },
          select: { id: true, identityAmbiguous: true },
        });

        if (!participant) {
          throw new Error("Beta participant not found");
        }

        if (participant.identityAmbiguous) {
          throw new Error(
            "Cannot reissue while participant identity is ambiguous — resolve the identity conflict first",
          );
        }

        const latest = await findLatestInvitationForParticipant(tx, participantId);

        if (!latest) {
          throw new Error("No invitation attempts found for this participant");
        }

        if (isPendingInvitation(latest, txNow)) {
          throw new Error(
            "Cannot reissue while the latest attempt is still pending — resend or revoke it instead",
          );
        }

        if (latest.acceptedAt) {
          throw new Error(
            "Cannot reissue while the latest attempt has already been accepted",
          );
        }

        if (!isReissueEligibleTerminalInvitation(latest, txNow)) {
          throw new Error(
            "Reissue is only allowed when the latest attempt is expired or revoked",
          );
        }

        const claimTimeoutCutoff = resendClaimEligibilityCutoff(txNow);
        if (
          latest.resendClaimedAt &&
          latest.resendClaimedAt >= claimTimeoutCutoff
        ) {
          throw new Error(
            "A delivery attempt is in progress for the latest invitation — try again shortly",
          );
        }

        const existingSuccessor = await tx.betaInvitation.findUnique({
          where: { reissuedFromInvitationId: latest.id },
          select: { id: true },
        });

        if (existingSuccessor) {
          throw new Error(
            "A reissue has already been created from this attempt — use the newer attempt instead",
          );
        }

        const carriedCampaign = campaignOverrideProvided
          ? options!.campaign!.trim() || null
          : latest.campaign;

        return tx.betaInvitation.create({
          data: {
            email: latest.email,
            token,
            code,
            notes: null,
            campaign: carriedCampaign,
            expiresAt: addDays(txNow, 30),
            createdAt: txNow,
            issuedAt: txNow,
            participantId,
            issuedByUserId,
            reissuedFromInvitationId: latest.id,
          },
        });
      },
      PARTICIPANT_MUTATION_TRANSACTION_OPTIONS,
    );

  let invitation: BetaInvitation | null = null;
  for (let attempt = 0; attempt < ACCEPT_MAX_RETRIES; attempt++) {
    try {
      invitation = await reissueAttempt();
      break;
    } catch (error) {
      if (isReissueUniqueViolation(error)) {
        throw new Error(
          "A reissue has already been created from this attempt — use the newer attempt instead",
        );
      }
      if (isSerializationFailure(error) && attempt < ACCEPT_MAX_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  if (!invitation) {
    throw new Error("Failed to reissue beta invitation after retries");
  }

  return buildInvitationResult(invitation);
}

export type ResendBetaInvitationClaim = {
  invitationId: string;
  claimId: string;
};

/**
 * Atomically claim the resend lease for a pending latest attempt.
 */
export async function claimBetaInvitationResend(
  invitationId: string,
): Promise<ResendBetaInvitationClaim> {
  const claimId = randomUUID();

  const invitation = await prisma.betaInvitation.findUnique({
    where: { id: invitationId },
    select: {
      id: true,
      participantId: true,
    },
  });

  if (!invitation) {
    throw new Error("Beta invitation not found");
  }

  const participant = await prisma.betaParticipant.findUnique({
    where: { id: invitation.participantId },
    select: { identityAmbiguous: true },
  });

  if (participant?.identityAmbiguous) {
    throw new Error(
      "Cannot resend email while participant identity is ambiguous — resolve the identity conflict first",
    );
  }

  return prisma.$transaction(async (tx) => {
    await acquireBetaParticipantMutationLock(
      tx,
      invitation.participantId,
      "claim",
    );

    const txNow = new Date();
    const latest = await findLatestInvitationForParticipant(
      tx,
      invitation.participantId,
    );

    if (!latest || latest.id !== invitationId) {
      throw new Error(LATEST_ATTEMPT_ONLY_ERROR);
    }

    if (!isPendingInvitation(latest, txNow)) {
      throw new Error("Only pending invitations can be resent");
    }

    const claimResult = await atomicClaimResendIfLatestAttempt(
      tx,
      invitationId,
      invitation.participantId,
      claimId,
      txNow,
    );

    if (claimResult === 0) {
      await throwResendClaimFailure(
        tx,
        invitationId,
        invitation.participantId,
        txNow,
      );
    }

    return { invitationId, claimId };
  }, PARTICIPANT_MUTATION_TRANSACTION_OPTIONS);
}

/**
 * Compare-and-set release of a resend claim owned by claimId.
 */
export async function releaseBetaInvitationResend(
  invitationId: string,
  claimId: string,
): Promise<void> {
  await prisma.betaInvitation.updateMany({
    where: { id: invitationId, resendClaimId: claimId },
    data: { resendClaimedAt: null, resendClaimId: null },
  });
}

export type BetaInvitationEmailSender = (input: {
  to: string;
  invitation: {
    id: string;
    email: string;
    inviteUrl: string;
    inviteCode: string;
    expiresAt: Date;
  };
  signal: AbortSignal;
  /** Correlates transport logs to the persisted delivery attempt (#175). */
  requestId: string;
}) => Promise<EmailResult>;

/**
 * Resolve the real EmailResult for a delivery invocation. Never throws: an
 * unexpected transport-contract violation (send() itself throwing, which it
 * never should per the EmailTransport contract) is mapped onto a generic
 * failed result here — this is the *only* place a FAILED outcome is invented,
 * and it is kept independent of persisting that outcome (#175 finding: a
 * database failure while recording a successful send must never be
 * mis-reported as a failed delivery).
 */
async function resolveEmailDeliveryResult(
  deliveryPromise: Promise<EmailResult>,
): Promise<EmailResult> {
  try {
    return await deliveryPromise;
  } catch {
    return { status: "failed", error: "Unexpected delivery error" };
  }
}

/**
 * Claim, deliver with an abortable provider deadline, then release the owned
 * claim only after the underlying send promise settles (#174). Persists an
 * immutable delivery-attempt record for the real outcome (#175) after the
 * claim is released, so the claim is never held open by a slow audit write.
 */
export async function deliverBetaInvitationEmailWithClaim(
  invitation: Pick<BetaInvitation, "id" | "email" | "code" | "expiresAt"> & {
    token: string;
  },
  inviteUrl: string,
  send: BetaInvitationEmailSender,
  attemptedByUserId: string,
  trigger: Extract<BetaInvitationDeliveryTriggerInput, "resend" | "reissue">,
  timeoutMs: number = BETA_EMAIL_PROVIDER_TIMEOUT_MS,
): Promise<EmailStatus> {
  // Resolved before any claim/send is attempted: failing closed here is
  // safer than sending on behalf of an actor whose account no longer exists
  // (#175 review finding).
  const actor = await resolveDeliveryActorSnapshot(attemptedByUserId);

  const claim = await claimBetaInvitationResend(invitation.id);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const requestId = randomUUID();
  // Invoked inside the guarded flow via Promise.resolve().then(...): an
  // injected sender that throws synchronously (rather than rejecting) would
  // otherwise escape this function entirely, skip claim release, and record
  // nothing (#175 review finding).
  const deliveryPromise = Promise.resolve().then(() =>
    send({
      to: invitation.email,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        inviteUrl,
        inviteCode: invitation.code,
        expiresAt: invitation.expiresAt,
      },
      signal: controller.signal,
      requestId,
    }),
  );

  let result: EmailResult;
  let occurredAt: Date;
  try {
    result = await resolveEmailDeliveryResult(deliveryPromise);
    // Captured while still holding the claim, so a later resend's audit
    // insert can never race ahead of this one and invert delivery-history
    // order (#175 review finding).
    occurredAt = new Date();
  } finally {
    clearTimeout(timeoutId);
    await deliveryPromise.catch(() => undefined);
    await releaseBetaInvitationResend(claim.invitationId, claim.claimId);
  }

  await recordBetaInvitationDeliveryAttempt({
    invitationId: invitation.id,
    trigger,
    result,
    attemptedByUserId,
    attemptedByEmail: actor.email,
    attemptedByDisplayName: actor.displayName,
    requestId,
    occurredAt,
  });

  return result.status;
}

/**
 * Deliver beta invitation email with an abortable provider deadline (#174).
 * Used when no resend claim is required (e.g. first invite on create).
 * Persists an immutable delivery-attempt record for the real outcome (#175).
 */
export async function deliverBetaInvitationEmail(
  invitation: Pick<BetaInvitation, "id" | "email" | "code" | "expiresAt"> & {
    token: string;
  },
  inviteUrl: string,
  send: BetaInvitationEmailSender,
  attemptedByUserId: string,
): Promise<EmailStatus> {
  // Resolved before send is attempted: failing closed here is safer than
  // sending on behalf of an actor whose account no longer exists (#175
  // review finding).
  const actor = await resolveDeliveryActorSnapshot(attemptedByUserId);

  const controller = new AbortController();
  const timeoutId = setTimeout(
    () => controller.abort(),
    BETA_EMAIL_PROVIDER_TIMEOUT_MS,
  );
  const requestId = randomUUID();
  // Invoked inside the guarded flow via Promise.resolve().then(...): an
  // injected sender that throws synchronously (rather than rejecting) would
  // otherwise escape this function entirely and record nothing (#175 review
  // finding).
  const deliveryPromise = Promise.resolve().then(() =>
    send({
      to: invitation.email,
      invitation: {
        id: invitation.id,
        email: invitation.email,
        inviteUrl,
        inviteCode: invitation.code,
        expiresAt: invitation.expiresAt,
      },
      signal: controller.signal,
      requestId,
    }),
  );

  let result: EmailResult;
  let occurredAt: Date;
  try {
    result = await resolveEmailDeliveryResult(deliveryPromise);
    occurredAt = new Date();
  } finally {
    clearTimeout(timeoutId);
    await deliveryPromise.catch(() => undefined);
  }

  await recordBetaInvitationDeliveryAttempt({
    invitationId: invitation.id,
    trigger: "issue",
    result,
    attemptedByUserId,
    attemptedByEmail: actor.email,
    attemptedByDisplayName: actor.displayName,
    requestId,
    occurredAt,
  });

  return result.status;
}

export type BetaValidationResult =
  | { status: "valid"; invitation: BetaInvitation }
  | { status: "not_found"; invitation: null }
  | { status: "expired"; invitation: null }
  | { status: "revoked"; invitation: null }
  | { status: "already_accepted"; invitation: BetaInvitation };

/**
 * Validate a beta invitation token.
 * Returns structured result with status and invitation.
 *
 * Validation order: accepted? → revoked? → expired? → valid
 */
export async function validateBetaToken(
  token: string
): Promise<BetaValidationResult> {
  const invitation = await prisma.betaInvitation.findUnique({
    where: { token },
  });

  if (!invitation) {
    return { status: "not_found", invitation: null };
  }

  if (invitation.acceptedAt) {
    return { status: "already_accepted", invitation };
  }

  if (invitation.revokedAt) {
    return { status: "revoked", invitation: null };
  }

  if (invitation.expiresAt < new Date()) {
    return { status: "expired", invitation: null };
  }

  return { status: "valid", invitation };
}

/**
 * Validate a beta invitation code (6-digit human-readable).
 * Returns structured result with status and invitation.
 *
 * Validation order: accepted? → revoked? → expired? → valid
 */
export async function validateBetaCode(
  code: string
): Promise<BetaValidationResult> {
  const normalizedCode = code.toUpperCase().trim();

  const invitation = await prisma.betaInvitation.findUnique({
    where: { code: normalizedCode },
  });

  if (!invitation) {
    return { status: "not_found", invitation: null };
  }

  if (invitation.acceptedAt) {
    return { status: "already_accepted", invitation };
  }

  if (invitation.revokedAt) {
    return { status: "revoked", invitation: null };
  }

  if (invitation.expiresAt < new Date()) {
    return { status: "expired", invitation: null };
  }

  return { status: "valid", invitation };
}

import {
  claimBetaParticipantUserIdWithTx,
  findExistingParticipantIdForIdentity,
  mergeBetaParticipantsWithTx,
  pickMergeSurvivorParticipantId,
  PARTICIPANT_SURVIVOR_ORDER,
} from "./betaParticipantIdentity";

/**
 * After a unique-violation abort, refetch the winning participant and merge
 * this invitation's participant into it inside a fresh transaction.
 */
async function mergeBetaParticipantUserIdAfterUniqueViolation(
  invitationId: string,
  userId: string,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const invitation = await tx.betaInvitation.findUnique({
      where: { id: invitationId },
      select: { participantId: true },
    });

    if (!invitation?.participantId) {
      throw new Error("Beta invitation not found");
    }

    const winner = await tx.betaParticipant.findFirst({
      where: { userId },
      select: { id: true },
      orderBy: PARTICIPANT_SURVIVOR_ORDER,
    });

    if (!winner) {
      throw new Error("Expected participant holding userId after unique violation");
    }

    const { survivorId, mergedAwayId } = await pickMergeSurvivorParticipantId(
      tx,
      invitation.participantId,
      winner.id,
    );

    await mergeBetaParticipantsWithTx(tx, mergedAwayId, survivorId);
  }, ACCEPT_TRANSACTION_OPTIONS);
}

async function runAcceptWithRetry(
  invitationId: string,
  userId: string,
  run: () => Promise<BetaInvitation>,
): Promise<BetaInvitation> {
  for (let attempt = 0; attempt < ACCEPT_MAX_RETRIES; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (isBetaParticipantUserIdUniqueViolation(error)) {
        await mergeBetaParticipantUserIdAfterUniqueViolation(invitationId, userId);
        return run();
      }
      if (isSerializationFailure(error) && attempt < ACCEPT_MAX_RETRIES - 1) {
        continue;
      }
      throw error;
    }
  }

  throw new Error("Failed to accept beta invitation after retries");
}

/**
 * Core accept-and-identity logic, executed inside a caller-supplied transaction.
 * Creates or reuses BetaParticipant identity and sets userId on first acceptance.
 */
export async function acceptBetaInvitationWithTx(
  tx: Prisma.TransactionClient,
  invitationId: string,
  userId: string,
): Promise<BetaInvitation> {
  const invitation = await tx.betaInvitation.findUnique({
    where: { id: invitationId },
  });

  if (!invitation) {
    throw new Error("Beta invitation not found");
  }

  if (invitation.acceptedAt) {
    if (invitation.acceptedByUserId === userId) {
      return invitation;
    }
    throw new Error("This beta invitation has already been accepted");
  }

  if (invitation.revokedAt) {
    throw new Error("This beta invitation has been revoked");
  }

  if (invitation.expiresAt < new Date()) {
    throw new Error("This beta invitation has expired");
  }

  const now = new Date();

  const updated = await tx.betaInvitation.updateMany({
    where: {
      id: invitationId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: {
      acceptedAt: now,
      acceptedByUserId: userId,
    },
  });

  if (updated.count !== 1) {
    const current = await tx.betaInvitation.findUnique({
      where: { id: invitationId },
    });
    if (current && current.acceptedByUserId === userId) {
      return current;
    }
    if (current?.revokedAt) {
      throw new Error("This beta invitation has been revoked");
    }
    throw new Error("This beta invitation has already been accepted");
  }

  let participantId = invitation.participantId;
  if (!participantId) {
    const participant = await tx.betaParticipant.create({ data: {} });
    participantId = participant.id;
    await tx.betaInvitation.update({
      where: { id: invitationId },
      data: { participantId },
    });
  }

  await claimBetaParticipantUserIdWithTx(tx, participantId, userId);

  const accepted = await tx.betaInvitation.findUnique({
    where: { id: invitationId },
  });

  if (!accepted) {
    throw new Error("Beta invitation not found");
  }

  return accepted;
}

/**
 * Accept a beta invitation for a user.
 * Called when a user completes the /redeem flow.
 */
export async function acceptBetaInvitation(
  invitationId: string,
  userId: string
): Promise<BetaInvitation> {
  const invitation = await prisma.betaInvitation.findUnique({
    where: { id: invitationId },
  });

  if (!invitation) {
    throw new Error("Beta invitation not found");
  }

  if (invitation.acceptedAt) {
    if (invitation.acceptedByUserId === userId) {
      return invitation;
    }
    throw new Error("This beta invitation has already been accepted");
  }

  if (invitation.revokedAt) {
    throw new Error("This beta invitation has been revoked");
  }

  if (invitation.expiresAt < new Date()) {
    throw new Error("This beta invitation has expired");
  }

  return runAcceptWithRetry(invitationId, userId, () =>
    prisma.$transaction(
      (tx) => acceptBetaInvitationWithTx(tx, invitationId, userId),
      ACCEPT_TRANSACTION_OPTIONS,
    ),
  );
}

/**
 * Find a pending alliance creation for a user.
 * Returns the accepted beta invitation if the user has accepted one
 * but hasn't yet created an alliance.
 */
export async function getPendingAllianceCreation(
  userId: string
): Promise<BetaInvitation | null> {
  const acceptedInvitation = await prisma.betaInvitation.findFirst({
    where: {
      acceptedByUserId: userId,
      allianceId: null,
    },
  });

  return acceptedInvitation;
}

/**
 * Get beta invitation by user ID.
 * Returns the user's accepted beta invitation, if any.
 */
export async function getBetaInvitationByUser(
  userId: string
): Promise<BetaInvitation | null> {
  return prisma.betaInvitation.findFirst({
    where: { acceptedByUserId: userId },
  });
}
