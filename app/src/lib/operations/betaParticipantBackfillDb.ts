import { createHash } from "node:crypto";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/client";
import {
  mergeBetaParticipantsWithTx,
  PARTICIPANT_SURVIVOR_ORDER,
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

export const BACKFILL_MANIFEST_VERSION = 1 as const;

export type BackfillRunOptions = {
  dryRun: boolean;
  /** Required on execute — binds writes to a reviewed dry-run manifest. */
  approvedManifest?: BackfillManifest;
  hooks?: BackfillTestHooks;
};

export type BackfillTestHooks = {
  afterSnapshotRead?: (context: {
    email: string;
    attempt: number;
    invitations: BackfillInvitationSnapshot[];
  }) => Promise<void>;
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

export type BackfillEmailPlanRecord = {
  email: string;
  nullInvitationCount: number;
  assignments: BackfillEmailPlan["assignments"];
  mergeParticipantIds: BackfillEmailPlan["mergeParticipantIds"];
  markAmbiguousParticipantIds: string[];
};

export type BackfillManifest = {
  version: typeof BACKFILL_MANIFEST_VERSION;
  generatedAt: string;
  dbIdentity: string;
  pendingNullInvitationCount: number;
  dryRun: true;
  checksum: string;
  emailPlans: BackfillEmailPlanRecord[];
  totals: Omit<BackfillRunSummary, "dryRun" | "emailPlans">;
};

export type BackfillManifestChecksumPayload = {
  version: typeof BACKFILL_MANIFEST_VERSION;
  dbIdentity: string;
  pendingNullInvitationCount: number;
  emailPlans: BackfillEmailPlanRecord[];
  totals: BackfillManifest["totals"];
};

export type ManifestVerdict =
  | { ok: true }
  | { ok: false; reason: string };

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

export function toBackfillEmailPlanRecord(
  plan: BackfillEmailPlan,
  nullInvitationCount: number,
): BackfillEmailPlanRecord {
  return {
    email: plan.email,
    nullInvitationCount,
    assignments: plan.assignments,
    mergeParticipantIds: plan.mergeParticipantIds,
    markAmbiguousParticipantIds: plan.markAmbiguousParticipantIds,
  };
}

export function emailPlansEqual(
  live: BackfillEmailPlan,
  nullInvitationCount: number,
  approved: BackfillEmailPlanRecord,
): boolean {
  return (
    JSON.stringify(toBackfillEmailPlanRecord(live, nullInvitationCount)) ===
    JSON.stringify(approved)
  );
}

function manifestShapeProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return "manifest is not an object";
  }
  const m = value as Record<string, unknown>;
  if (m.version !== BACKFILL_MANIFEST_VERSION) {
    return `manifest version ${JSON.stringify(m.version)} is unsupported (expected ${BACKFILL_MANIFEST_VERSION})`;
  }
  if (typeof m.checksum !== "string" || !/^[0-9a-f]{64}$/.test(m.checksum)) {
    return "checksum is missing or is not a 64-character hex string";
  }
  if (typeof m.dbIdentity !== "string" || m.dbIdentity.length === 0) {
    return "dbIdentity is missing";
  }
  if (typeof m.generatedAt !== "string") {
    return "generatedAt is missing";
  }
  if (m.dryRun !== true) {
    return "dryRun must be true";
  }
  if (typeof m.pendingNullInvitationCount !== "number") {
    return "pendingNullInvitationCount is missing";
  }
  if (!Array.isArray(m.emailPlans)) {
    return "emailPlans must be an array";
  }
  if (!m.totals || typeof m.totals !== "object") {
    return "totals is missing";
  }
  return null;
}

export function validateBackfillManifestShape(value: unknown): BackfillManifest {
  const problem = manifestShapeProblem(value);
  if (problem) {
    throw new Error(`Invalid manifest: ${problem}`);
  }
  return value as BackfillManifest;
}

export function backfillManifestChecksumPayload(input: {
  dbIdentity: string;
  pendingNullInvitationCount: number;
  emailPlans: BackfillEmailPlanRecord[];
  totals: BackfillManifest["totals"];
}): BackfillManifestChecksumPayload {
  return {
    version: BACKFILL_MANIFEST_VERSION,
    dbIdentity: input.dbIdentity,
    pendingNullInvitationCount: input.pendingNullInvitationCount,
    emailPlans: input.emailPlans,
    totals: input.totals,
  };
}

export function buildBackfillManifest(input: {
  dbIdentity: string;
  pendingNullInvitationCount: number;
  emailPlans: BackfillEmailPlanRecord[];
  totals: BackfillManifest["totals"];
  now?: Date;
}): BackfillManifest {
  const payload = backfillManifestChecksumPayload({
    dbIdentity: input.dbIdentity,
    pendingNullInvitationCount: input.pendingNullInvitationCount,
    emailPlans: input.emailPlans,
    totals: input.totals,
  });
  return {
    ...payload,
    generatedAt: (input.now ?? new Date()).toISOString(),
    dryRun: true,
    checksum: buildBackfillManifestChecksum(payload),
  };
}

export function verifyBackfillManifestIntegrity(
  manifest: BackfillManifest,
): ManifestVerdict {
  const shapeProblem = manifestShapeProblem(manifest);
  if (shapeProblem) {
    return { ok: false, reason: shapeProblem };
  }
  const selfPayload = backfillManifestChecksumPayload({
    dbIdentity: manifest.dbIdentity,
    pendingNullInvitationCount: manifest.pendingNullInvitationCount,
    emailPlans: manifest.emailPlans,
    totals: manifest.totals,
  });
  const selfChecksum = buildBackfillManifestChecksum(selfPayload);
  if (selfChecksum !== manifest.checksum) {
    return {
      ok: false,
      reason:
        "manifest checksum does not match its own recorded contents (the file may be corrupted or was hand-edited); regenerate it with a fresh dry run",
    };
  }
  return { ok: true };
}

export function verifyBackfillManifest(
  manifest: BackfillManifest,
  fresh: {
    dbIdentity: string;
    payload: BackfillManifestChecksumPayload;
  },
): ManifestVerdict {
  if (manifest.version !== BACKFILL_MANIFEST_VERSION) {
    return {
      ok: false,
      reason: `manifest version ${manifest.version} is unsupported`,
    };
  }
  if (manifest.dbIdentity !== fresh.dbIdentity) {
    return {
      ok: false,
      reason: `manifest was generated for database "${manifest.dbIdentity}" but the current target is "${fresh.dbIdentity}"`,
    };
  }
  const freshChecksum = buildBackfillManifestChecksum(fresh.payload);
  if (manifest.checksum !== freshChecksum) {
    return {
      ok: false,
      reason:
        "the database changed since the dry run (re-resolved plan checksum does not match the manifest); regenerate and re-review the manifest",
    };
  }
  return { ok: true };
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

/**
 * Merge every participant referenced in the planner's merge pairs onto one
 * canonical survivor (createdAt ASC, id ASC). Avoids deleting the planner's
 * lexicographic survivor when pair-wise reordering would pick a different winner.
 */
export async function applyParticipantMergeChain(
  tx: TxClient,
  mergeParticipantIds: Array<{ survivorId: string; mergedAwayId: string }>,
): Promise<number> {
  if (mergeParticipantIds.length === 0) {
    return 0;
  }

  const participantIds = new Set<string>();
  for (const merge of mergeParticipantIds) {
    participantIds.add(merge.survivorId);
    participantIds.add(merge.mergedAwayId);
  }

  const rows = await tx.betaParticipant.findMany({
    where: { id: { in: [...participantIds] } },
    select: { id: true },
    orderBy: PARTICIPANT_SURVIVOR_ORDER,
  });

  if (rows.length <= 1) {
    return 0;
  }

  const survivorId = rows[0]!.id;
  let mergesPerformed = 0;
  for (let i = 1; i < rows.length; i++) {
    await mergeBetaParticipantsWithTx(tx, rows[i]!.id, survivorId);
    mergesPerformed += 1;
  }
  return mergesPerformed;
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

  const mergesPerformed = await applyParticipantMergeChain(
    tx,
    plan.mergeParticipantIds,
  );

  return {
    invitationsAssigned,
    participantsCreated,
    mergesPerformed,
    ambiguousFlagsSet,
  };
}

function findApprovedPlanForEmail(
  manifest: BackfillManifest,
  email: string,
): BackfillEmailPlanRecord | undefined {
  return manifest.emailPlans.find((record) => record.email === email);
}

function assertLivePlanMatchesManifest(
  email: string,
  live: BackfillEmailPlan | null,
  nullCount: number,
  approved: BackfillEmailPlanRecord | undefined,
): void {
  if (!live && !approved) {
    return;
  }
  if (!live || !approved) {
    throw new Error(
      `Refusing to execute: live plan for ${email} does not match reviewed manifest`,
    );
  }
  if (!emailPlansEqual(live, nullCount, approved)) {
    throw new Error(
      `Refusing to execute: live plan for ${email} does not match reviewed manifest`,
    );
  }
}

async function backfillEmailGroupInTransaction(
  prisma: PrismaClient,
  email: string,
  dryRun: boolean,
  options: Pick<BackfillRunOptions, "approvedManifest" | "hooks"> = {},
): Promise<{
  plan: BackfillEmailPlan | null;
  stats: BackfillEmailPlanSummary | null;
  applied: {
    invitationsAssigned: number;
    participantsCreated: number;
    mergesPerformed: number;
    ambiguousFlagsSet: number;
  } | null;
  attemptsUsed: number;
}> {
  const approvedPlan = options.approvedManifest
    ? findApprovedPlanForEmail(options.approvedManifest, email)
    : undefined;

  for (let attempt = 0; attempt < MAX_SERIALIZABLE_RETRIES; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const invitations = await loadEmailInvitations(tx, email);
        const nullCount = invitations.filter((row) => !row.participantId).length;

        if (options.hooks?.afterSnapshotRead) {
          await options.hooks.afterSnapshotRead({
            email,
            attempt,
            invitations,
          });
        }

        const plan = planBackfillForEmailGroup(email, invitations);
        if (options.approvedManifest) {
          assertLivePlanMatchesManifest(
            email,
            plan,
            nullCount,
            approvedPlan,
          );
        }
        if (!plan) {
          return { plan: null, stats: null, applied: null };
        }

        const stats = summarizeBackfillEmailPlan(plan, nullCount);
        const applied = await applyEmailBackfillPlan(tx, plan, dryRun);
        return { plan, stats, applied };
      }, SERIALIZABLE_TRANSACTION_OPTIONS);

      return { ...result, attemptsUsed: attempt + 1 };
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
  options: Partial<Pick<BackfillRunOptions, "dryRun" | "approvedManifest" | "hooks">> = {},
): Promise<{
  plan: BackfillEmailPlan | null;
  stats: BackfillEmailPlanSummary | null;
  applied: {
    invitationsAssigned: number;
    participantsCreated: number;
    mergesPerformed: number;
    ambiguousFlagsSet: number;
  } | null;
  attemptsUsed: number;
}> {
  return backfillEmailGroupInTransaction(
    prisma,
    email,
    options.dryRun ?? false,
    options,
  );
}

export async function resolveBackfillManifestPayload(
  prisma: PrismaClient,
): Promise<{
  pendingNullInvitationCount: number;
  emailPlans: BackfillEmailPlanRecord[];
  totals: BackfillManifest["totals"];
}> {
  const dryRunSummary = await runBetaParticipantBackfill(prisma, { dryRun: true });
  const emailPlans = dryRunSummary.planRecords;
  return {
    pendingNullInvitationCount: await countNullParticipantInvitations(prisma),
    emailPlans,
    totals: {
      emailsProcessed: dryRunSummary.emailsProcessed,
      emailsSkipped: dryRunSummary.emailsSkipped,
      invitationsAssigned: dryRunSummary.invitationsAssigned,
      participantsCreated: dryRunSummary.participantsCreated,
      mergesPerformed: dryRunSummary.mergesPerformed,
      ambiguousFlagsSet: dryRunSummary.ambiguousFlagsSet,
    },
  };
}

export type BackfillRunResult = BackfillRunSummary & {
  planRecords: BackfillEmailPlanRecord[];
};

export async function runBetaParticipantBackfill(
  prisma: PrismaClient,
  options: Partial<BackfillRunOptions> = {},
): Promise<BackfillRunResult> {
  const dryRun = options.dryRun ?? true;

  const summary: BackfillRunResult = {
    dryRun,
    emailsProcessed: 0,
    emailsSkipped: 0,
    invitationsAssigned: 0,
    participantsCreated: 0,
    mergesPerformed: 0,
    ambiguousFlagsSet: 0,
    emailPlans: [],
    planRecords: [],
  };

  const emails = await fetchAllEmailsNeedingBackfill(prisma);
  for (const email of emails) {
    const result = await backfillEmailGroupInTransaction(
      prisma,
      email,
      dryRun,
      options,
    );
    if (!result.plan || !result.stats) {
      summary.emailsSkipped += 1;
      continue;
    }

    summary.emailsProcessed += 1;
    summary.emailPlans.push(result.stats);
    summary.planRecords.push(
      toBackfillEmailPlanRecord(result.plan, result.stats.nullInvitationCount),
    );
    if (result.applied) {
      summary.invitationsAssigned += result.applied.invitationsAssigned;
      summary.participantsCreated += result.applied.participantsCreated;
      summary.mergesPerformed += result.applied.mergesPerformed;
      summary.ambiguousFlagsSet += result.applied.ambiguousFlagsSet;
    }
  }

  return summary;
}
