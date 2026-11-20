import "server-only";
import { Prisma } from "@/app/generated/prisma/client";
import { requirePlatformAdmin } from "../auth/requirePlatformAdmin";
import { prisma } from "../prisma";
import { reasons, workflows, type Reason, type Workflow } from "../importDiagnostics/codes";
import { activityStart, type ActivityPeriod } from "./activityPeriod";
import { pilotError, type ActivityRow } from "./ocrPilotActivity";
import { getQaWordSnapshot } from "./qaWordSnapshot";

export type ImportErrorRow = {
  key: string; when: string; alliance: string; account: string; method: string;
  reason: string; source: string; build: string | null;
};
type DbRow = { key: string; at: Date; alliance: string | null; actor: string; workflow: Workflow; code: string | null; build: string | null };
export type ImportStep = { key: string; when: string; action: string; outcome: string; build: string | null; scores: number; saved: string | null };
export type MethodFilter = "all" | "screenshot" | "spreadsheet";
type Filters = { period: ActivityPeriod; method: MethodFilter; alliance: string; page: number; snapshot: boolean };
const pageSize = 25;

function present(row: DbRow): ImportErrorRow {
  const scan = row.key.startsWith("scan:");
  return { key: row.key, when: row.at.toISOString(), alliance: row.alliance || "Former alliance",
    account: row.actor, method: workflows[row.workflow], build: row.build,
    source: scan ? "Scan record" : "Reported by the browser",
    reason: scan ? pilotError("FAILED", row.code)! : reasons[row.code as Reason] ?? "Cause unavailable" };
}

function snapshotRow(row: ActivityRow): ImportErrorRow {
  return { key: "scan:" + row.id, when: row.createdAt.toISOString(), alliance: "WORD", account: "WORD pilot account",
    method: workflows.screenshot, build: row.clientBuild, source: "Scan record", reason: pilotError(row.status, row.outcome)! };
}

export async function getImportErrors({ period, method, alliance, page, snapshot }: Filters) {
  await requirePlatformAdmin();
  if (snapshot) {
    const data = await getQaWordSnapshot(period);
    const rows = data.activity.filter(a => a.status === "FAILED" && method !== "spreadsheet" && (!alliance || alliance.toLowerCase() === "word")).map(snapshotRow);
    return { rows: rows.slice(page * pageSize, (page + 1) * pageSize), more: false, capturedAt: data.capturedAt };
  }
  const start = activityStart(period, new Date());
  const rows = await prisma.$queryRaw<DbRow[]>(Prisma.sql`
    WITH events AS (
      SELECT 'scan:' || a.id AS key, a."createdAt" AS at, a."allianceId", a."actorUserId" AS actor,
        'screenshot' AS workflow, a.outcome AS code, a."clientBuild" AS build
      FROM "OcrEvaluationAttempt" a WHERE a.status = 'FAILED'
      UNION ALL
      SELECT 'report:' || r.id, r."createdAt", r."allianceId", r."actorId", r.workflow, r.code, r."clientBuild"
      FROM "ImportErrorReport" r
      WHERE r."scanRequestId" IS NULL OR NOT EXISTS (SELECT 1 FROM "OcrEvaluationAttempt" a
        WHERE a."requestId" = r."scanRequestId" AND a."allianceId" = r."allianceId" AND a."actorUserId" = r."actorId" AND a.status = 'FAILED')
    )
    SELECT e.key, e.at, a.name AS alliance, COALESCE(u."displayName", e.actor) AS actor, e.workflow, e.code, e.build
    FROM events e LEFT JOIN "Alliance" a ON a.id = e."allianceId" LEFT JOIN "User" u ON u.id = e.actor
    WHERE TRUE
      ${start ? Prisma.sql`AND e.at >= ${start}` : Prisma.empty}
      ${alliance ? Prisma.sql`AND lower(a.name) = lower(${alliance})` : Prisma.empty}
      ${method === "screenshot" ? Prisma.sql`AND e.workflow = 'screenshot'` : method === "spreadsheet" ? Prisma.sql`AND e.workflow <> 'screenshot'` : Prisma.empty}
    ORDER BY e.at DESC, e.key DESC LIMIT ${pageSize + 1} OFFSET ${page * pageSize}
  `);
  return { rows: rows.slice(0, pageSize).map(present), more: rows.length > pageSize, capturedAt: null };
}

function step(row: Pick<ActivityRow, "id"|"createdAt"|"retry"|"automaticRetry"|"status"|"outcome"|"clientBuild"|"scores"|"lastSavedAt">): ImportStep {
  return { key: "scan:" + row.id, when: row.createdAt.toISOString(), build: row.clientBuild,
    action: row.automaticRetry ? "Automatic retry" : row.retry ? "User retry" : "Scan",
    outcome: row.status === "FAILED" ? pilotError(row.status, row.outcome)! : row.status === "READY" ? "Ready for review" : "Processing",
    scores: row.scores, saved: row.lastSavedAt?.toISOString() ?? null };
}

export async function getRelatedScans(key: string, snapshot: boolean) {
  await requirePlatformAdmin();
  if (typeof key !== "string" || !/^scan:[a-zA-Z0-9-]{1,70}$/.test(key)) return [];
  const id = key.slice(5);
  if (snapshot) {
    const data = await getQaWordSnapshot("all");
    const event = data.activity.find(a => a.id === id);
    if (!event) return [];
    return data.activity.filter(a => a.firstId === event.firstId).sort((a,b) => a.createdAt.getTime() - b.createdAt.getTime()).map(step);
  }
  const rows = await prisma.$queryRaw<ActivityRow[]>(Prisma.sql`
    SELECT a.id, a."createdAt", a.status, a.outcome, a."clientBuild", a."retryOf" IS NOT NULL AS retry, a."automaticRetry",
      saved.scores, saved."lastSavedAt" FROM "OcrEvaluationAttempt" selected JOIN "OcrEvaluationAttempt" a
      ON a."allianceId" = selected."allianceId" AND a."actorUserId" = selected."actorUserId"
      AND a."memberId" IS NOT DISTINCT FROM selected."memberId" AND a."sourceDigest" = selected."sourceDigest"
    CROSS JOIN LATERAL (
      SELECT count(DISTINCT e.id)::int AS scores, max(b."savedAt") AS "lastSavedAt"
      FROM "OcrScoreSource" s JOIN "MemberMetricEntry" e ON e.id = s."entryId"
      JOIN "OcrScoreBatch" b ON b.id = e."ocrBatchId"
      WHERE s."attemptId" = a.id AND b."allianceId" = a."allianceId" AND b."actorId" = a."actorUserId"
    ) saved WHERE selected.id = ${id} ORDER BY a."createdAt", a.id
  `);
  return rows.map(step);
}
