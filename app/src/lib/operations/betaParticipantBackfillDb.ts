import { createHash } from "node:crypto";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import {
  mergeBetaParticipantsWithTx,
  pickMergeSurvivorParticipantId,
} from "../betaParticipantIdentity";
import { connectionIdentity, productionIdentities } from "../productionDb";
import {
  planBackfillForEmailGroup,
  summarizeBackfillEmailPlan,
  type BackfillEmailPlan,
  type BackfillEmailPlanSummary,
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
  emailPlans: BackfillEmailPlanSummary[];
};

export type BackfillManifest = {
  version: 1;
  generatedAt: string;
  dbIdentity: string;
  pendingNullInvitationCount: number;
  dryRun: true;
  checksum: string;
  emailPlans: BackfillEmailPlanSummary[];
  totals: Omit<BackfillRunSummary, "dryRun" | "emailPlans">;
};

const DEFAULT_BATCH_SIZE = 50;
const MAX_SERIALIZABLE_RETRIES = 3;

const SERIALIZABLE_TRANSACTION_OPTIONS = {
  isolationLevel: "Serializable" as const,
  maxWait: 5000,
  timeout: 10000,
};

type TxClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

function isSerializationFailure(error: unknown): boolean {
  if (
    error instanceof PrismaClientKnownRequestError &&
    error.code === "P2034"
  ) {
    return true;
  }
  if (error instanceof Error) {
    if ("code" in error && (error as { code?: string }).code === "P2034") {
      return true;
    }
    if (
      error.message.includes("TransactionWriteConflict") ||
      error.name === "TransactionWriteConflict"
    ) {
      return true;
    }
  }
  return false;
}

/** Re-exported for the backfill CLI's production-safety boundary. */
export function resolveBackfillTargetIdentity(): {
  identity: string;
  isProduction: boolean;
  hostname: string;
} {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    throw new Error("DATABASE_URL is required.");
  }
  const identity = connectionIdentity(dbUrl);
  const directUrl = process.env.DIRECT_URL;
  if (directUrl && connectionIdentity(directUrl) !== identity) {
    throw new Error(
      "DATABASE_URL and DIRECT_URL resolve to different databases; refusing to run.",
    );
  }
  let hostname: string;
  try {
    hostname = new URL(dbUrl).hostname;
  } catch {
    hostname = identity;
  }
  const allow = productionIdentities(process.env.PRODUCTION_DB_HOSTS);
  return { identity, isProduction: allow.includes(identity), hostname };
}

export function buildBackfillManifestChecksum(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function buildBackfillManifest(input: {
  dbIdentity: string;
  pendingNullInvitationCount: number;
  summary: BackfillRunSummary;
}): BackfillManifest {
  const payload = {
    version: 1 as const,
    generatedAt: new Date().toISOString(),
    dbIdentity: input.dbIdentity,
    pendingNullInvitationCount: input.pendingNullInvitationCount,
    dryRun: true as const,
    emailPlans: input.summary.emailPlans,
    totals: {
      emailsProcessed: input.summary.emailsProcessed,
      emailsSkipped: input.summary.emailsSkipped,
      invitationsAssigned: input.summary.invitationsAssigned,
      participantsCreated: input.summary.participantsCreated,
      mergesPerformed: input.summary.mergesPerformed,
      ambiguousFlagsSet: input.summary.ambiguousFlagsSet,
    },
  };
  return {
    ...payload,
    checksum: buildBackfillManifestChecksum(payload),
  };
}

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

export async function fetchAllEmailsNeedingBackfill(
  prisma: PrismaClient,
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ email: string }>>`
    SELECT DISTINCT email
    FROM "BetaInvitation"
    WHERE "participantId" IS NULL
    ORDER BY email ASC
  `;
  return rows.map((row) => row.email);
}

async function loadEmailInvitations(
  tx: TxClient,
  email: string,
): Promise<BackfillInvitationSnapshot[]> {
  return tx.betaInvitation.findMany({
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
  tx: TxClient,
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
  tx: TxClient,
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

async function backfillEmailGroupInTransaction(
  prisma: PrismaClient,
  email: string,
  dryRun: boolean,
): Promise<{
  plan: BackfillEmailPlan | null;
  stats: BackfillEmailPlanSummary | null;
  applied: {
    invitationsAssigned: number;
    participantsCreated: number;
    mergesPerformed: number;
    ambiguousFlagsSet: number;
  } | null;
}> {
  for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(async (tx) => {
        const invitations = await loadEmailInvitations(tx, email);
        const nullCount = invitations.filter((row) => !row.participantId).length;
        const plan = planBackfillForEmailGroup(email, invitations);
        if (!plan) {
          return { plan: null, stats: null, applied: null };
        }

        const stats = summarizeBackfillEmailPlan(plan, nullCount);
        const applied = await applyEmailBackfillPlan(tx, plan, dryRun);
        return { plan, stats, applied };
      }, SERIALIZABLE_TRANSACTION_OPTIONS);
    } catch (error) {
      if (
        isSerializationFailure(error) &&
        attempt < MAX_SERIALIZABLE_RETRIES - 1
      ) {
        continue;
      }
      throw error;
    }
  }

  throw new Error(`Failed to backfill email group after retries: ${email}`);
}

export async function backfillEmailGroup(
  prisma: PrismaClient,
  email: string,
  options: Pick<BackfillRunOptions, "dryRun">,
): Promise<{
  plan: BackfillEmailPlan | null;
  stats: BackfillEmailPlanSummary | null;
  applied: {
    invitationsAssigned: number;
    participantsCreated: number;
    mergesPerformed: number;
    ambiguousFlagsSet: number;
  } | null;
}> {
  return backfillEmailGroupInTransaction(prisma, email, options.dryRun ?? false);
}

export async function runBetaParticipantBackfill(
  prisma: PrismaClient,
  options: Partial<BackfillRunOptions> = {},
): Promise<BackfillRunSummary> {
  const dryRun = options.dryRun ?? true;

  const summary: BackfillRunSummary = {
    dryRun,
    emailsProcessed: 0,
    emailsSkipped: 0,
    invitationsAssigned: 0,
    participantsCreated: 0,
    mergesPerformed: 0,
    ambiguousFlagsSet: 0,
    emailPlans: [],
  };

  const emails = await fetchAllEmailsNeedingBackfill(prisma);
  for (const email of emails) {
    const result = await backfillEmailGroupInTransaction(prisma, email, dryRun);
    if (!result.plan || !result.stats) {
      summary.emailsSkipped += 1;
      continue;
    }

    summary.emailsProcessed += 1;
    summary.emailPlans.push(result.stats);
    if (result.applied) {
      summary.invitationsAssigned += result.applied.invitationsAssigned;
      summary.participantsCreated += result.applied.participantsCreated;
      summary.mergesPerformed += result.applied.mergesPerformed;
      summary.ambiguousFlagsSet += result.applied.ambiguousFlagsSet;
    }
  }

  return summary;
}
