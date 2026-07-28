import { randomUUID, randomBytes } from "node:crypto";
import { prisma } from "./prisma";
import { getRedeemUrl } from "./appUrl";
import type { BetaInvitation } from "@/app/generated/prisma/client";
import type { Prisma } from "@/app/generated/prisma/client";
import { normalizeEmail } from "./email/normalize";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";

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
export function isPendingInvitation(invitation: BetaInvitation): boolean {
  // Expiry boundary matches the rest of the module: an invitation is expired
  // only when expiresAt < now (validateBetaToken/validateBetaCode), so it is
  // still valid — and therefore pending — when expiresAt >= now.
  return (
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt >= new Date()
  );
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
            "A pending beta invitation already exists for this email"
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

        // Always create a new invitation row — never mutate history — but reuse
        // the established canonical participant when this email/user already
        // has beta history (expired/revoked/accepted-no-alliance attempts).
        const participantId = await resolveCanonicalParticipantIdForIssuance(
          tx,
          normalizedEmail,
        );

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
            participantId,
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
 * Uses atomic update to prevent race conditions.
 */
export async function revokeBetaInvitation(invitationId: string): Promise<void> {
  // Atomic update: only revoke if not already accepted or revoked
  const result = await prisma.betaInvitation.updateMany({
    where: {
      id: invitationId,
      acceptedAt: null,
      revokedAt: null,
    },
    data: { revokedAt: new Date() },
  });

  if (result.count === 0) {
    // Re-fetch to determine why update failed
    const invitation = await prisma.betaInvitation.findUnique({
      where: { id: invitationId },
    });

    if (!invitation) {
      throw new Error("Beta invitation not found");
    }

    if (invitation.acceptedAt) {
      throw new Error("Cannot revoke an accepted invitation");
    }

    if (invitation.revokedAt) {
      throw new Error("Invitation has already been revoked");
    }

    // Shouldn't reach here, but handle gracefully
    throw new Error("Failed to revoke invitation");
  }
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

const PARTICIPANT_SURVIVOR_ORDER: Prisma.BetaParticipantOrderByWithRelationInput[] =
  [{ createdAt: "asc" }, { id: "asc" }];

/**
 * Resolve the canonical BetaParticipant for a new invitation row.
 * Reuses the oldest linked participant for this email or user identity so
 * terminal/accepted-no-alliance history does not split one person (#174).
 */
async function resolveCanonicalParticipantIdForIssuance(
  tx: Prisma.TransactionClient,
  normalizedEmail: string,
): Promise<string> {
  const fromEmailHistory = await tx.betaParticipant.findFirst({
    where: {
      invitations: { some: { email: normalizedEmail } },
    },
    orderBy: PARTICIPANT_SURVIVOR_ORDER,
    select: { id: true },
  });
  if (fromEmailHistory) {
    return fromEmailHistory.id;
  }

  const existingUser = await tx.user.findUnique({
    where: { email: normalizedEmail },
    select: { id: true },
  });
  if (existingUser) {
    const fromUser = await tx.betaParticipant.findFirst({
      where: { userId: existingUser.id },
      orderBy: PARTICIPANT_SURVIVOR_ORDER,
      select: { id: true },
    });
    if (fromUser) {
      return fromUser.id;
    }
  }

  const created = await tx.betaParticipant.create({ data: {} });
  return created.id;
}

/**
 * Pick the stable merge survivor: createdAt ASC, id ASC (#174).
 */
async function pickMergeSurvivorParticipantId(
  tx: Prisma.TransactionClient,
  participantIdA: string,
  participantIdB: string,
): Promise<{ survivorId: string; mergedAwayId: string }> {
  if (participantIdA === participantIdB) {
    return { survivorId: participantIdA, mergedAwayId: participantIdB };
  }

  const rows = await tx.betaParticipant.findMany({
    where: { id: { in: [participantIdA, participantIdB] } },
    select: { id: true },
    orderBy: PARTICIPANT_SURVIVOR_ORDER,
  });

  if (rows.length < 2) {
    throw new Error("Beta participant not found for merge");
  }

  return { survivorId: rows[0].id, mergedAwayId: rows[1].id };
}

/**
 * Reassign invitations onto the survivor and delete the merged-away row.
 * Transfers userId onto the survivor when only the merged-away row holds it.
 */
async function mergeBetaParticipantsWithTx(
  tx: Prisma.TransactionClient,
  mergedAwayId: string,
  survivorId: string,
): Promise<void> {
  if (mergedAwayId === survivorId) {
    return;
  }

  const [mergedAway, survivor] = await Promise.all([
    tx.betaParticipant.findUnique({
      where: { id: mergedAwayId },
      select: { userId: true },
    }),
    tx.betaParticipant.findUnique({
      where: { id: survivorId },
      select: { userId: true },
    }),
  ]);

  await tx.betaInvitation.updateMany({
    where: { participantId: mergedAwayId },
    data: { participantId: survivorId },
  });

  if (mergedAway?.userId && !survivor?.userId) {
    await tx.betaParticipant.update({
      where: { id: survivorId },
      data: { userId: mergedAway.userId },
    });
  }

  await tx.betaParticipant.delete({
    where: { id: mergedAwayId },
  });
}

/**
 * Claim `userId` on a participant, merging into an existing participant when
 * another row already holds that userId.
 */
async function claimBetaParticipantUserIdWithTx(
  tx: Prisma.TransactionClient,
  participantId: string,
  userId: string,
): Promise<void> {
  const participant = await tx.betaParticipant.findUnique({
    where: { id: participantId },
    select: { id: true, userId: true },
  });

  if (!participant) {
    throw new Error("Beta participant not found");
  }

  if (participant.userId === userId) {
    return;
  }

  if (participant.userId && participant.userId !== userId) {
    throw new Error("Beta participant identity conflict");
  }

  const existingHolder = await tx.betaParticipant.findFirst({
    where: { userId },
    select: { id: true },
    orderBy: PARTICIPANT_SURVIVOR_ORDER,
  });

  if (existingHolder && existingHolder.id !== participantId) {
    const { survivorId, mergedAwayId } = await pickMergeSurvivorParticipantId(
      tx,
      participantId,
      existingHolder.id,
    );
    await mergeBetaParticipantsWithTx(tx, mergedAwayId, survivorId);
    return;
  }

  await tx.betaParticipant.update({
    where: { id: participantId },
    data: { userId },
  });
}

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
