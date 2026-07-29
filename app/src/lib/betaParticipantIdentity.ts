import type { Prisma } from "@/app/generated/prisma/client";

export const PARTICIPANT_SURVIVOR_ORDER: Prisma.BetaParticipantOrderByWithRelationInput[] =
  [{ createdAt: "asc" }, { id: "asc" }];

/**
 * Resolve the canonical BetaParticipant for a new invitation row.
 * Reuses the oldest linked participant for this email or user identity so
 * terminal/accepted-no-alliance history does not split one person (#174).
 * Fails closed when email history and the current user's participant disagree.
 */
export async function resolveCanonicalParticipantIdForIssuance(
  tx: Prisma.TransactionClient,
  normalizedEmail: string,
  existingUserId: string | null = null,
): Promise<string> {
  const fromEmailHistory = await tx.betaParticipant.findFirst({
    where: {
      invitations: { some: { email: normalizedEmail } },
    },
    orderBy: PARTICIPANT_SURVIVOR_ORDER,
    select: { id: true },
  });

  let fromUser: { id: string } | null = null;
  let userId = existingUserId;
  if (!userId) {
    const existingUser = await tx.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    userId = existingUser?.id ?? null;
  }
  if (userId) {
    fromUser = await tx.betaParticipant.findFirst({
      where: { userId },
      orderBy: PARTICIPANT_SURVIVOR_ORDER,
      select: { id: true },
    });
  }

  if (fromEmailHistory && fromUser) {
    if (fromEmailHistory.id !== fromUser.id) {
      throw new Error(
        "This email's invitation history belongs to a different beta participant than the current account holder",
      );
    }
    return fromEmailHistory.id;
  }

  if (fromEmailHistory) {
    return fromEmailHistory.id;
  }

  if (fromUser) {
    return fromUser.id;
  }

  const created = await tx.betaParticipant.create({ data: {} });
  return created.id;
}

/**
 * Resolve an existing canonical participant for an identity without creating one.
 * Used to reject generic "invite new participant" when history already exists (#174).
 */
export async function findExistingParticipantIdForIdentity(
  tx: Prisma.TransactionClient,
  normalizedEmail: string,
  existingUserId: string | null = null,
): Promise<string | null> {
  const fromEmailHistory = await tx.betaParticipant.findFirst({
    where: {
      invitations: { some: { email: normalizedEmail } },
    },
    orderBy: PARTICIPANT_SURVIVOR_ORDER,
    select: { id: true },
  });

  let fromUser: { id: string } | null = null;
  let userId = existingUserId;
  if (!userId) {
    const existingUser = await tx.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    userId = existingUser?.id ?? null;
  }
  if (userId) {
    fromUser = await tx.betaParticipant.findFirst({
      where: { userId },
      orderBy: PARTICIPANT_SURVIVOR_ORDER,
      select: { id: true },
    });
  }

  if (fromEmailHistory && fromUser) {
    if (fromEmailHistory.id !== fromUser.id) {
      throw new Error(
        "This email's invitation history belongs to a different beta participant than the current account holder",
      );
    }
    return fromEmailHistory.id;
  }

  return fromEmailHistory?.id ?? fromUser?.id ?? null;
}

/**
 * Pick the stable merge survivor: createdAt ASC, id ASC (#174).
 */
export async function pickMergeSurvivorParticipantId(
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
export async function mergeBetaParticipantsWithTx(
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

  if (mergedAway?.userId) {
    if (survivor?.userId && survivor.userId !== mergedAway.userId) {
      throw new Error("Beta participant identity conflict");
    }
    if (!survivor?.userId) {
      // Clear the merged-away holder before assigning the survivor so PR 1b's
      // userId unique constraint cannot see two rows claiming the same user.
      await tx.betaParticipant.update({
        where: { id: mergedAwayId },
        data: { userId: null },
      });
      await tx.betaParticipant.update({
        where: { id: survivorId },
        data: { userId: mergedAway.userId },
      });
    }
  }

  await tx.betaParticipant.delete({
    where: { id: mergedAwayId },
  });
}

/**
 * Claim `userId` on a participant, merging into an existing participant when
 * another row already holds that userId.
 */
export async function claimBetaParticipantUserIdWithTx(
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
