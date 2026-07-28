import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  mergeBetaParticipantsWithTx,
  pickMergeSurvivorParticipantId,
} from "../betaParticipantIdentity";
import {
  planBackfillForEmailGroup,
  summarizeBackfillEmailPlan,
  type BackfillEmailPlan,
  type BackfillInvitationSnapshot,
  type BackfillParticipantTarget,
} from "./betaParticipantBackfill";

export type BackfillRunOptions = {
  dryRun: boolean;
  emailBatchSize: number;
};

export type BackfillRunSummary = {
  dryRun: boolean;
  emailsProcessed: number;
  emailsSkipped: number;
  invitationsAssigned: number;
  participantsCreated: number;
  mergesPerformed: number;
  ambiguousFlagsSet: number;
};

const DEFAULT_BATCH_SIZE = 50;

export async function countNullParticipantInvitations(
  prisma: PrismaClient,
): Promise<number> {
  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT COUNT(*)::bigint AS count
    FROM "BetaInvitation"
    WHERE "participantId" IS NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

export async function fetchEmailsNeedingBackfill(
  prisma: PrismaClient,
  limit: number,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ email: string }>>`
    SELECT DISTINCT email
    FROM "BetaInvitation"
    WHERE "participantId" IS NULL
    ORDER BY email ASC
    LIMIT ${limit}
  `;
  return rows.map((row) => row.email);
}

async function loadEmailInvitations(
  prisma: PrismaClient,
  email: string,
): Promise<BackfillInvitationSnapshot[]> {
  return prisma.betaInvitation.findMany({
    where: { email },
    select: {
      id: true,
      participantId: true,
      acceptedAt: true,
      acceptedByUserId: true,
    },
    orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
  });
}

async function resolveTargetParticipantId(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  target: BackfillParticipantTarget,
  createdSlotIds: Map<string, string>,
): Promise<string> {
  if (target.kind === "existing") {
    return target.participantId;
  }

  const existing = createdSlotIds.get(target.slotKey);
  if (existing) {
    return existing;
  }

  const created = await tx.betaParticipant.create({
    data: {
      userId: target.userId,
      identityAmbiguous: target.identityAmbiguous,
    },
    select: { id: true },
  });
  createdSlotIds.set(target.slotKey, created.id);
  return created.id;
}

async function applyEmailBackfillPlan(
  tx: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0],
  plan: BackfillEmailPlan,
  dryRun: boolean,
): Promise<{
  invitationsAssigned: number;
  participantsCreated: number;
  mergesPerformed: number;
  ambiguousFlagsSet: number;
}> {
  if (dryRun) {
    const createKeys = new Set(
      plan.assignments
        .filter((assignment) => assignment.target.kind === "create")
        .map(
          (assignment) =>
            (assignment.target as Extract<
              BackfillParticipantTarget,
              { kind: "create" }
            >).slotKey,
        ),
    );
    return {
      invitationsAssigned: plan.assignments.length,
      participantsCreated: createKeys.size,
      mergesPerformed: plan.mergeParticipantIds.length,
      ambiguousFlagsSet:
        plan.markAmbiguousParticipantIds.length +
        (createKeys.has("__ambiguous__") ? 1 : 0),
    };
  }

  const createdSlotIds = new Map<string, string>();
  let invitationsAssigned = 0;
  let participantsCreated = 0;

  for (const assignment of plan.assignments) {
    const hadSlot =
      assignment.target.kind === "create"
        ? createdSlotIds.has(assignment.target.slotKey)
        : true;
    const participantId = await resolveTargetParticipantId(
      tx,
      assignment.target,
      createdSlotIds,
    );
    if (assignment.target.kind === "create" && !hadSlot) {
      participantsCreated += 1;
    }

    await tx.betaInvitation.update({
      where: { id: assignment.invitationId },
      data: { participantId },
    });
    if (assignment.target.userId) {
      await tx.betaParticipant.updateMany({
        where: { id: participantId, userId: null },
        data: { userId: assignment.target.userId },
      });
    }
    invitationsAssigned += 1;
  }

  let ambiguousFlagsSet = 0;
  for (const participantId of plan.markAmbiguousParticipantIds) {
    await tx.betaParticipant.update({
      where: { id: participantId },
      data: { identityAmbiguous: true },
    });
    ambiguousFlagsSet += 1;
  }

  let mergesPerformed = 0;
  for (const merge of plan.mergeParticipantIds) {
    const ordered = await pickMergeSurvivorParticipantId(
      tx,
      merge.survivorId,
      merge.mergedAwayId,
    );
    await mergeBetaParticipantsWithTx(
      tx,
      ordered.mergedAwayId,
      ordered.survivorId,
    );
    mergesPerformed += 1;
  }

  return {
    invitationsAssigned,
    participantsCreated,
    mergesPerformed,
    ambiguousFlagsSet,
  };
}

export async function backfillEmailGroup(
  prisma: PrismaClient,
  email: string,
  options: Pick<BackfillRunOptions, "dryRun">,
): Promise<{
  plan: BackfillEmailPlan | null;
  stats: ReturnType<typeof summarizeBackfillEmailPlan> | null;
  applied: {
    invitationsAssigned: number;
    participantsCreated: number;
    mergesPerformed: number;
    ambiguousFlagsSet: number;
  } | null;
}> {
  const invitations = await loadEmailInvitations(prisma, email);
  const nullCount = invitations.filter((row) => !row.participantId).length;
  const plan = planBackfillForEmailGroup(email, invitations);
  if (!plan) {
    return { plan: null, stats: null, applied: null };
  }

  const stats = summarizeBackfillEmailPlan(plan, nullCount);
  const applied = await prisma.$transaction(async (tx) =>
    applyEmailBackfillPlan(tx, plan, options.dryRun),
  );

  return { plan, stats, applied };
}

export async function runBetaParticipantBackfill(
  prisma: PrismaClient,
  options: Partial<BackfillRunOptions> = {},
): Promise<BackfillRunSummary> {
  const dryRun = options.dryRun ?? false;
  const emailBatchSize = options.emailBatchSize ?? DEFAULT_BATCH_SIZE;

  const summary: BackfillRunSummary = {
    dryRun,
    emailsProcessed: 0,
    emailsSkipped: 0,
    invitationsAssigned: 0,
    participantsCreated: 0,
    mergesPerformed: 0,
    ambiguousFlagsSet: 0,
  };

  while (true) {
    const emails = await fetchEmailsNeedingBackfill(prisma, emailBatchSize);
    if (emails.length === 0) {
      break;
    }

    for (const email of emails) {
      const result = await backfillEmailGroup(prisma, email, { dryRun });
      if (!result.plan) {
        summary.emailsSkipped += 1;
        continue;
      }

      summary.emailsProcessed += 1;
      if (result.applied) {
        summary.invitationsAssigned += result.applied.invitationsAssigned;
        summary.participantsCreated += result.applied.participantsCreated;
        summary.mergesPerformed += result.applied.mergesPerformed;
        summary.ambiguousFlagsSet += result.applied.ambiguousFlagsSet;
      }
    }

    if (dryRun) {
      break;
    }
  }

  return summary;
}
