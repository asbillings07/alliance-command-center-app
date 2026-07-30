import { extractFeedbackContext } from "../extractFeedbackContext";

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

export type FeedbackInboxBackfillOptions = {
  dryRun: boolean;
};

// The Prisma client is accessed dynamically in scripts/tests.
/* eslint-disable @typescript-eslint/no-explicit-any */
export type BackfillDb = any;

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
): {
  allianceUpdates: Array<{ id: string; allianceId: string }>;
  triageCreates: string[];
  summary: Omit<FeedbackInboxBackfillSummary, "dryRun" | "totalFeedbackRows">;
} {
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

export async function runFeedbackInboxBackfill(
  db: BackfillDb,
  options: FeedbackInboxBackfillOptions,
): Promise<FeedbackInboxBackfillSummary> {
  const rows = await listFeedbackInboxBackfillRows(db);
  const plan = planFeedbackInboxBackfill(rows);

  if (!options.dryRun) {
    for (const update of plan.allianceUpdates) {
      await db.feedback.update({
        where: { id: update.id },
        data: { allianceId: update.allianceId },
      });
    }
    for (const feedbackId of plan.triageCreates) {
      await db.feedbackTriage.create({
        data: {
          feedbackId,
          status: "NEW",
          needsResponse: true,
          stateRevision: 0,
        },
      });
    }
  }

  return {
    dryRun: options.dryRun,
    totalFeedbackRows: rows.length,
    ...plan.summary,
  };
}
