import { createHash } from "node:crypto";
import { extractFeedbackContext } from "../extractFeedbackContext";
import { resolveBackfillTargetIdentity } from "./betaParticipantBackfillDb";

export type FeedbackInboxBackfillRow = {
  id: string;
  url: string;
  allianceId: string | null;
  hasTriage: boolean;
};

export type FeedbackInboxBackfillSummary = {
  dryRun: boolean;
  totalFeedbackRows: number;
  allianceIdUpdates: number;
  allianceIdSkippedAlreadySet: number;
  allianceIdSkippedNoSegment: number;
  triageProjectionsCreated: number;
  triageProjectionsSkippedExisting: number;
};

export type FeedbackInboxBackfillPlanRecord = {
  allianceUpdates: Array<{ id: string; allianceId: string }>;
  triageCreates: string[];
  summary: Omit<FeedbackInboxBackfillSummary, "dryRun" | "totalFeedbackRows">;
};

export const FEEDBACK_INBOX_BACKFILL_MANIFEST_VERSION = 1 as const;

export type FeedbackInboxBackfillManifest = {
  version: typeof FEEDBACK_INBOX_BACKFILL_MANIFEST_VERSION;
  generatedAt: string;
  dbIdentity: string;
  dryRun: true;
  checksum: string;
  totalFeedbackRows: number;
  plan: FeedbackInboxBackfillPlanRecord;
};

export type FeedbackInboxBackfillManifestChecksumPayload = {
  version: typeof FEEDBACK_INBOX_BACKFILL_MANIFEST_VERSION;
  dbIdentity: string;
  totalFeedbackRows: number;
  plan: FeedbackInboxBackfillPlanRecord;
};

export type FeedbackInboxBackfillValidationResult = {
  ok: boolean;
  violations: string[];
};

export type FeedbackInboxBackfillOptions = {
  dryRun: boolean;
  /** Required on execute — binds writes to a reviewed dry-run manifest. */
  approvedManifest?: FeedbackInboxBackfillManifest;
  /** Test seam: invoked after each row write during execute. */
  hooks?: {
    afterRowWrite?: (context: {
      kind: "allianceId" | "triageProjection";
      feedbackId: string;
    }) => Promise<void> | void;
  };
};

export type FeedbackInboxBackfillExecuteResult = FeedbackInboxBackfillSummary & {
  allianceIdApplied: number;
  triageProjectionsApplied: number;
  validation: FeedbackInboxBackfillValidationResult;
};

export type ManifestVerdict =
  | { ok: true }
  | { ok: false; reason: string };

// The Prisma client is accessed dynamically in scripts/tests.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type BackfillDb = any;

/** Re-exported for the backfill CLI's production-safety boundary. */
export { resolveBackfillTargetIdentity };

export async function listFeedbackInboxBackfillRows(
  db: BackfillDb,
): Promise<FeedbackInboxBackfillRow[]> {
  const rows = await db.feedback.findMany({
    select: {
      id: true,
      url: true,
      allianceId: true,
      triage: { select: { feedbackId: true } },
    },
    orderBy: { id: "asc" },
  });
  return rows.map((row: {
    id: string;
    url: string;
    allianceId: string | null;
    triage: { feedbackId: string } | null;
  }) => ({
    id: row.id,
    url: row.url,
    allianceId: row.allianceId,
    hasTriage: row.triage !== null,
  }));
}

export function planFeedbackInboxBackfill(
  rows: FeedbackInboxBackfillRow[],
): FeedbackInboxBackfillPlanRecord {
  const allianceUpdates: Array<{ id: string; allianceId: string }> = [];
  const triageCreates: string[] = [];
  let allianceIdSkippedAlreadySet = 0;
  let allianceIdSkippedNoSegment = 0;
  let triageProjectionsSkippedExisting = 0;

  for (const row of rows) {
    if (row.allianceId === null) {
      const { allianceId } = extractFeedbackContext(row.url);
      if (allianceId) {
        allianceUpdates.push({ id: row.id, allianceId });
      } else {
        allianceIdSkippedNoSegment += 1;
      }
    } else {
      allianceIdSkippedAlreadySet += 1;
    }

    if (row.hasTriage) {
      triageProjectionsSkippedExisting += 1;
    } else {
      triageCreates.push(row.id);
    }
  }

  return {
    allianceUpdates,
    triageCreates,
    summary: {
      allianceIdUpdates: allianceUpdates.length,
      allianceIdSkippedAlreadySet,
      allianceIdSkippedNoSegment,
      triageProjectionsCreated: triageCreates.length,
      triageProjectionsSkippedExisting,
    },
  };
}

export function buildFeedbackInboxBackfillManifestChecksum(payload: unknown): string {
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export function feedbackInboxBackfillManifestChecksumPayload(input: {
  dbIdentity: string;
  totalFeedbackRows: number;
  plan: FeedbackInboxBackfillPlanRecord;
}): FeedbackInboxBackfillManifestChecksumPayload {
  return {
    version: FEEDBACK_INBOX_BACKFILL_MANIFEST_VERSION,
    dbIdentity: input.dbIdentity,
    totalFeedbackRows: input.totalFeedbackRows,
    plan: input.plan,
  };
}

export function buildFeedbackInboxBackfillManifest(input: {
  dbIdentity: string;
  totalFeedbackRows: number;
  plan: FeedbackInboxBackfillPlanRecord;
  now?: Date;
}): FeedbackInboxBackfillManifest {
  const payload = feedbackInboxBackfillManifestChecksumPayload({
    dbIdentity: input.dbIdentity,
    totalFeedbackRows: input.totalFeedbackRows,
    plan: input.plan,
  });
  return {
    ...payload,
    generatedAt: (input.now ?? new Date()).toISOString(),
    dryRun: true,
    checksum: buildFeedbackInboxBackfillManifestChecksum(payload),
  };
}

function manifestShapeProblem(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return "manifest is not an object";
  }
  const m = value as Record<string, unknown>;
  if (m.version !== FEEDBACK_INBOX_BACKFILL_MANIFEST_VERSION) {
    return `manifest version ${JSON.stringify(m.version)} is unsupported (expected ${FEEDBACK_INBOX_BACKFILL_MANIFEST_VERSION})`;
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
  if (typeof m.totalFeedbackRows !== "number") {
    return "totalFeedbackRows is missing";
  }
  if (!m.plan || typeof m.plan !== "object") {
    return "plan is missing";
  }
  return null;
}

export function validateFeedbackInboxBackfillManifestShape(
  value: unknown,
): FeedbackInboxBackfillManifest {
  const problem = manifestShapeProblem(value);
  if (problem) {
    throw new Error(`Invalid manifest: ${problem}`);
  }
  return value as FeedbackInboxBackfillManifest;
}

export function verifyFeedbackInboxBackfillManifestIntegrity(
  manifest: FeedbackInboxBackfillManifest,
): ManifestVerdict {
  const shapeProblem = manifestShapeProblem(manifest);
  if (shapeProblem) {
    return { ok: false, reason: shapeProblem };
  }
  const selfPayload = feedbackInboxBackfillManifestChecksumPayload({
    dbIdentity: manifest.dbIdentity,
    totalFeedbackRows: manifest.totalFeedbackRows,
    plan: manifest.plan,
  });
  const selfChecksum = buildFeedbackInboxBackfillManifestChecksum(selfPayload);
  if (selfChecksum !== manifest.checksum) {
    return {
      ok: false,
      reason:
        "manifest checksum does not match its own recorded contents (the file may be corrupted or was hand-edited); regenerate it with a fresh dry run",
    };
  }
  return { ok: true };
}

export function verifyFeedbackInboxBackfillManifest(
  manifest: FeedbackInboxBackfillManifest,
  fresh: {
    dbIdentity: string;
    payload: FeedbackInboxBackfillManifestChecksumPayload;
  },
): ManifestVerdict {
  if (manifest.version !== FEEDBACK_INBOX_BACKFILL_MANIFEST_VERSION) {
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
  const freshChecksum = buildFeedbackInboxBackfillManifestChecksum(fresh.payload);
  if (manifest.checksum !== freshChecksum) {
    return {
      ok: false,
      reason:
        "the database changed since the dry run (re-resolved plan checksum does not match the manifest); regenerate and re-review the manifest",
    };
  }
  return { ok: true };
}

/**
 * Execute-time verification: exact checksum match, or a safe resume/idempotent
 * re-run where remaining work is a non-conflicting subset of the reviewed plan.
 */
export function verifyFeedbackInboxBackfillManifestForExecute(
  manifest: FeedbackInboxBackfillManifest,
  fresh: {
    dbIdentity: string;
    payload: FeedbackInboxBackfillManifestChecksumPayload;
  },
  rows: FeedbackInboxBackfillRow[],
): ManifestVerdict {
  const exact = verifyFeedbackInboxBackfillManifest(manifest, fresh);
  if (exact.ok) {
    return exact;
  }

  const rowById = new Map(rows.map((row) => [row.id, row]));
  for (const update of manifest.plan.allianceUpdates) {
    const row = rowById.get(update.id);
    if (!row) {
      return { ok: false, reason: `Feedback ${update.id} is missing` };
    }
    if (row.allianceId !== null && row.allianceId !== update.allianceId) {
      return {
        ok: false,
        reason: `Feedback ${update.id} allianceId drifted since the dry run`,
      };
    }
    if (row.allianceId === null) {
      const { allianceId } = extractFeedbackContext(row.url);
      if (allianceId !== update.allianceId) {
        return {
          ok: false,
          reason: `Feedback ${update.id} URL drifted since the dry run`,
        };
      }
    }
  }

  for (const feedbackId of manifest.plan.triageCreates) {
    if (!rowById.has(feedbackId)) {
      return { ok: false, reason: `Feedback ${feedbackId} is missing` };
    }
  }

  const freshPlan = planFeedbackInboxBackfill(rows);
  for (const freshUpdate of freshPlan.allianceUpdates) {
    const approved = manifest.plan.allianceUpdates.find((update) => update.id === freshUpdate.id);
    if (!approved || approved.allianceId !== freshUpdate.allianceId) {
      return {
        ok: false,
        reason:
          "the database changed since the dry run (re-resolved plan checksum does not match the manifest); regenerate and re-review the manifest",
      };
    }
  }
  for (const freshId of freshPlan.triageCreates) {
    if (!manifest.plan.triageCreates.includes(freshId)) {
      return {
        ok: false,
        reason:
          "the database changed since the dry run (re-resolved plan checksum does not match the manifest); regenerate and re-review the manifest",
      };
    }
  }

  return { ok: true };
}

export async function resolveFeedbackInboxBackfillManifestPayload(
  db: BackfillDb,
): Promise<FeedbackInboxBackfillManifestChecksumPayload & { totalFeedbackRows: number }> {
  const rows = await listFeedbackInboxBackfillRows(db);
  const plan = planFeedbackInboxBackfill(rows);
  return {
    ...feedbackInboxBackfillManifestChecksumPayload({
      dbIdentity: "",
      totalFeedbackRows: rows.length,
      plan,
    }),
    totalFeedbackRows: rows.length,
  };
}

export async function validateFeedbackInboxBackfillCompletion(
  db: BackfillDb,
  manifest: FeedbackInboxBackfillManifest,
): Promise<FeedbackInboxBackfillValidationResult> {
  const violations: string[] = [];

  if (manifest.plan.allianceUpdates.length > 0) {
    const ids = manifest.plan.allianceUpdates.map((update) => update.id);
    const rows = await db.feedback.findMany({
      where: { id: { in: ids } },
      select: { id: true, allianceId: true },
    });
    const rowById = new Map<string, { id: string; allianceId: string | null }>(
      rows.map((row: { id: string; allianceId: string | null }) => [row.id, row]),
    );
    for (const planned of manifest.plan.allianceUpdates) {
      const row = rowById.get(planned.id);
      if (!row) {
        violations.push(`Feedback ${planned.id} is missing`);
        continue;
      }
      if (row.allianceId !== planned.allianceId) {
        violations.push(
          `Feedback ${planned.id} allianceId is ${JSON.stringify(row.allianceId)}; expected ${JSON.stringify(planned.allianceId)}`,
        );
      }
    }
  }

  if (manifest.plan.triageCreates.length > 0) {
    const existing = await db.feedbackTriage.count({
      where: { feedbackId: { in: manifest.plan.triageCreates } },
    });
    if (existing !== manifest.plan.triageCreates.length) {
      violations.push(
        `Expected ${manifest.plan.triageCreates.length} FeedbackTriage projection(s); found ${existing}`,
      );
    }
  }

  return { ok: violations.length === 0, violations };
}

async function applyFeedbackInboxBackfillPlan(
  db: BackfillDb,
  plan: FeedbackInboxBackfillPlanRecord,
  hooks?: FeedbackInboxBackfillOptions["hooks"],
): Promise<{ allianceIdApplied: number; triageProjectionsApplied: number }> {
  let allianceIdApplied = 0;
  let triageProjectionsApplied = 0;

  for (const update of plan.allianceUpdates) {
    const { count } = await db.feedback.updateMany({
      where: { id: update.id, allianceId: null },
      data: { allianceId: update.allianceId },
    });
    allianceIdApplied += count;
    if (count > 0 && hooks?.afterRowWrite) {
      await hooks.afterRowWrite({ kind: "allianceId", feedbackId: update.id });
    }
  }

  for (const feedbackId of plan.triageCreates) {
    const result = await db.feedbackTriage.createMany({
      data: [
        {
          feedbackId,
          status: "NEW",
          needsResponse: true,
          stateRevision: 0,
        },
      ],
      skipDuplicates: true,
    });
    triageProjectionsApplied += result.count;
    if (result.count > 0 && hooks?.afterRowWrite) {
      await hooks.afterRowWrite({ kind: "triageProjection", feedbackId });
    }
  }

  return { allianceIdApplied, triageProjectionsApplied };
}

export async function runFeedbackInboxBackfill(
  db: BackfillDb,
  options: FeedbackInboxBackfillOptions,
): Promise<FeedbackInboxBackfillExecuteResult> {
  const rows = await listFeedbackInboxBackfillRows(db);
  const plan = planFeedbackInboxBackfill(rows);

  const summary: FeedbackInboxBackfillSummary = {
    dryRun: options.dryRun,
    totalFeedbackRows: rows.length,
    ...plan.summary,
  };

  if (options.dryRun) {
    return {
      ...summary,
      allianceIdApplied: 0,
      triageProjectionsApplied: 0,
      validation: { ok: true, violations: [] },
    };
  }

  if (!options.approvedManifest) {
    throw new Error("Refusing to execute without an approved manifest.");
  }

  const approved = options.approvedManifest;
  const freshPayload = feedbackInboxBackfillManifestChecksumPayload({
    dbIdentity: approved.dbIdentity,
    totalFeedbackRows: rows.length,
    plan,
  });
  const verdict = verifyFeedbackInboxBackfillManifestForExecute(approved, {
    dbIdentity: approved.dbIdentity,
    payload: freshPayload,
  }, rows);
  if (!verdict.ok) {
    throw new Error(`Refusing to execute: ${verdict.reason}`);
  }

  const applied = await applyFeedbackInboxBackfillPlan(
    db,
    approved.plan,
    options.hooks,
  );
  const validation = await validateFeedbackInboxBackfillCompletion(db, approved);

  return {
    ...summary,
    allianceIdApplied: applied.allianceIdApplied,
    triageProjectionsApplied: applied.triageProjectionsApplied,
    validation,
  };
}
