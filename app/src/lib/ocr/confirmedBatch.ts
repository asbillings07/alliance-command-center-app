import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { metricEntryProvenance } from "../metrics/metricEntryProvenance";
import { OcrEvaluationError } from "./config";
import { batchWriteContext, readEvaluationContent, type EvaluationTarget } from "./evaluation";
import { isolatedOcrDatabaseAvailable } from "./isolatedDatabase";
import { isRankingWeekPeriod, rankingWindow, reconcileOverlap, type BatchCandidate } from "./ranking";
import { evaluationTransport } from "./transport";
import { touchAllianceSetupActivity } from "../touchAllianceSetupActivity";

export type BatchSelection = {
  allianceId: string; periodId: string; attemptIds: string[]; excluded: string[];
  week: string; captureDate: string; dailyMetric: string; weeklyMetric: string;
};
export type ScoreComparison = { memberId: string; member: string; metric: string; metricId: string;
  window: string; value: number; previous: number | null; previousId: string | null };
type Decision = { comparison: string; lowerConfirmed: boolean };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(message: string): never { throw new OcrEvaluationError(message); }
const validId = (id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 180;
const rowId = (row: BatchCandidate) => row.attemptId + ":" + row.key;

export async function reviewOrSaveBatch(actorId: string, input: BatchSelection, decision?: Decision) {
  if (!isolatedOcrDatabaseAvailable()) fail("Screenshot saving is unavailable here.");
  if (!input || !validId(input.allianceId) || !validId(input.periodId) || !Array.isArray(input.attemptIds)
    || !input.attemptIds.length || input.attemptIds.length > 20 || !input.attemptIds.every(validId)
    || new Set(input.attemptIds).size !== input.attemptIds.length || !Array.isArray(input.excluded)
    || input.excluded.length > 3000 || !input.excluded.every(validId)) fail("Choose a valid screenshot batch.");
  const target: EvaluationTarget = { actorId, allianceId: input.allianceId, memberId: null, scope: "batch" };
  const transport = await evaluationTransport();
  const candidates: BatchCandidate[] = [];
  for (const [i, id] of input.attemptIds.entries()) {
    const result = await readEvaluationContent(target, id, "result", transport);
    if (result instanceof Uint8Array || !result.batchReview?.rows.length || result.contextChanged) fail("The source or roster changed. Reopen the ranking and review its matches.");
    if (result.batchReview.context.kind === "today") fail("Today's Duel can contain an in-progress score. To save results, use Daily Rank with its day selected or Weekly Rank.");
    const window = rankingWindow(result.batchReview.context, input.week, input.captureDate);
    if (!window) fail("Confirm the screenshot dates before saving.");
    candidates.push(...result.batchReview.rows.map(row => ({ ...row, attemptId: id, source: i + 1, window })));
  }
  const groups = reconcileOverlap(candidates);
  const excluded = new Set(input.excluded);
  if (input.excluded.some(key => !groups.some(({row}) => rowId(row) === key))) fail("The reviewed rows changed. Review this batch again.");
  const chosen = groups.filter(({row}) => !excluded.has(rowId(row)));
  if (!chosen.length || chosen.length > 300) fail("Choose between one and 300 matched scores.");
  for (const { row, conflict } of chosen) {
    if (conflict || !row.memberId || row.status !== "exact" || row.value === null || row.value > 2147483647)
      fail("Exclude unresolved rows or conflicting scores before saving.");
  }
  const metricFor = (r: BatchCandidate) => r.window!.startsWith("week:") ? input.weeklyMetric : input.dailyMetric;
  const batchId = hash([input.allianceId, input.periodId, chosen.flatMap(g => g.sources.map(r => JSON.stringify([rowId(r), r.memberId, r.window, r.value, metricFor(r)]))).sort()]);
  return prisma.$transaction(async tx => {
    const current = await batchWriteContext(tx, target);
    const attempts = await tx.ocrEvaluationAttempt.findMany({ where: { id: { in: input.attemptIds }, allianceId: input.allianceId, memberId: null, status: "READY", expiresAt: { gt: new Date() } },
      select: { contextKey: true } });
    if (attempts.length !== input.attemptIds.length || attempts.some(a => a.contextKey !== current.contextKey)) fail("The roster, permission or source changed. Review the batch again.");
    const period = await tx.metricPeriod.findFirst({ where: { id: input.periodId, allianceId: input.allianceId, active: true },
      select: { name: true, startsAt: true, endsAt: true, periodMetrics: { where: { active: true, metric: { active: true, type: "NUMERIC", allianceId: input.allianceId } }, select: { metric: { select: { id: true, name: true, observationGrain: true } } } } } });
    if (!period) fail("Choose an active evaluation period.");
    const toDay = (d: Date | null) => d?.toISOString().slice(0, 10);
    const start = toDay(period.startsAt), end = toDay(period.endsAt);
    const slots = chosen.map(({ row }) => {
      const weekly = row.window!.startsWith("week:");
      const day = weekly ? row.window!.slice(5) : row.window!;
      const metric = period.periodMetrics.find(m => m.metric.id === metricFor(row))?.metric;
      if (!metric || metric.observationGrain !== (weekly ? "PERIOD_VALUE" : "DAILY_OBSERVATION"))
        fail("Choose an active numeric metric for each screenshot type.");
      if (!weekly && (!start || !end)) fail("Daily scores require a period with a start and end date.");
      if ((start && day < start) || (end && day > end)) fail("A screenshot date falls outside this evaluation period.");
      if (weekly && !isRankingWeekPeriod(day, start, end))
        fail("A weekly total requires an evaluation period covering that one scoring week starting on that Monday.");
      return { memberId: row.memberId!, metricId: metric.id, day: weekly ? null : day, metric: metric.name,
        window: row.window!, member: row.matchedName!, value: row.value! };
    });
    // Lock destination members in a consistent order. The score-entry FK also
    // locks these records for manual/spreadsheet writers.
    await tx.$queryRaw`SELECT id FROM "AllianceMember" WHERE "allianceId"=${input.allianceId}
      AND id IN (${Prisma.join([...new Set(slots.map(s => s.memberId))])}) ORDER BY id FOR UPDATE`;
    const prior = await tx.$queryRaw<Array<{ memberId: string; metricId: string; day: string | null; id: string; value: number | null }>>`
      SELECT s."memberId", s."metricId", s.day, e.id, e.value FROM jsonb_to_recordset(${JSON.stringify(slots)}::jsonb)
        AS s("memberId" text,"metricId" text,day text) JOIN LATERAL (
        SELECT id,value FROM "MemberMetricEntry" WHERE "periodId"=${input.periodId} AND "metricId"=s."metricId" AND "allianceMemberId"=s."memberId"
        AND "observedOn" IS NOT DISTINCT FROM s.day::date ORDER BY "recordedAt" DESC,"createdAt" DESC,id DESC LIMIT 1
      ) e ON true`;
    const comparisons: ScoreComparison[] = slots.map(s => {
      const old = prior.find(p => p.memberId === s.memberId && p.metricId === s.metricId && p.day === s.day);
      return { memberId: s.memberId, metricId: s.metricId, member: s.member, metric: s.metric, window: s.window, value: s.value, previous: old?.value ?? null, previousId: old?.id ?? null };
    });
    const comparison = hash([batchId, actorId, current.contextKey, current.consent.processing?.id, period.name, comparisons]);
    const response = { batchId, comparison, comparisons, excluded: excluded.size, saved: false };
    const existing = await tx.ocrScoreBatch.findUnique({ where: { id: batchId } });
    if (existing) return { ...response, excluded: existing.excludedRows, saved: true };
    const used = await tx.ocrScoreSource.findMany({ where: { attemptId: { in: input.attemptIds } }, select: { attemptId: true, rowKey: true } });
    const usedKeys = new Set(used.map(s => s.attemptId + ":" + s.rowKey));
    if (chosen.some(g => g.sources.some(r => usedKeys.has(rowId(r))))) fail("Some source rows were already saved. Exclude those rows and review the remaining scores.");
    if (!decision) return response;
    if (comparison !== decision.comparison) fail("The scores or review context changed. Close this dialog and review the current values.");
    if (comparisons.some(r => r.previous !== null && r.value < r.previous) && decision.lowerConfirmed !== true) fail("Confirm the lower scores before applying this batch.");
    const provenance = await metricEntryProvenance(tx, input.allianceId, actorId, "OCR_SCREENSHOT");
    await tx.ocrScoreBatch.create({ data: { id: batchId, allianceId: input.allianceId, actorId, periodId: input.periodId, excludedRows: excluded.size } });
    const entries = slots.map(s => ({ ...provenance, id: randomUUID(), ocrBatchId: batchId, periodId: input.periodId, metricId: s.metricId,
      allianceMemberId: s.memberId, value: s.value, observedOn: s.day ? new Date(s.day) : null,
      observationGrain: s.day ? "DAILY_OBSERVATION" as const : "PERIOD_VALUE" as const }));
    await tx.memberMetricEntry.createMany({ data: entries });
    await tx.ocrScoreSource.createMany({ data: chosen.flatMap((g, i) => g.sources.map(r => ({
      entryId: entries[i].id, attemptId: r.attemptId, rowKey: r.key, window: r.window!,
    }))) });
    await touchAllianceSetupActivity(tx, input.allianceId);
    return { ...response, saved: true };
  }, { isolationLevel: "Serializable", timeout: 15000 });
}
