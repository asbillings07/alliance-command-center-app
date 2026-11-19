import { planBatchDestination, applyBatchDestination } from "./batchDestination";
import { productionPilotConfigured } from "./productionPilot";
import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { metricEntryProvenance } from "../metrics/metricEntryProvenance";
import { OcrEvaluationError } from "./config";
import { batchWriteContext, readEvaluationContent, type EvaluationTarget } from "./evaluation";
import { isolatedOcrDatabaseAvailable } from "./isolatedDatabase";
import { exactNameKey, rankingWindow, reconcileOverlap, resolveRankingChoices, type BatchCandidate } from "./ranking";
import { evaluationTransport } from "./transport";
import { touchAllianceSetupActivity } from "../touchAllianceSetupActivity";

export type BatchSelection = {
  allianceId: string; periodId: string; attemptIds: string[]; excluded: string[]; sourcePicks?: string[];
  week: string; captureDate: string; dailyMetric: string; weeklyMetric: string;
};
export type ScoreComparison = { memberId: string; member: string; metric: string; metricId: string;
  window: string; value: number; previous: number | null; previousId: string | null; createMember: boolean };
type Decision = { comparison: string; lowerConfirmed: boolean; createMembersConfirmed?: boolean };
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fail(message: string): never { throw new OcrEvaluationError(message); }
const validId = (id: unknown) => typeof id === "string" && id.length > 0 && id.length <= 180;
const rowId = (row: BatchCandidate) => row.attemptId + ":" + row.key;

export async function reviewOrSaveBatch(actorId: string, input: BatchSelection, decision?: Decision) {
  if (!isolatedOcrDatabaseAvailable() && !productionPilotConfigured()) fail("Screenshot saving is unavailable here.");
  if (!input || !validId(input.allianceId) || !validId(input.periodId) || !Array.isArray(input.attemptIds)
    || !input.attemptIds.length || input.attemptIds.length > 20 || !input.attemptIds.every(validId)
    || new Set(input.attemptIds).size !== input.attemptIds.length || !Array.isArray(input.excluded)
    || input.excluded.length > 3000 || !input.excluded.every(validId)) fail("Choose a valid screenshot batch.");
  const picks = input.sourcePicks ?? [];
  if (!Array.isArray(picks) || picks.length > 300 || !picks.every(validId) || new Set(picks).size !== picks.length) fail("Choose one source per conflicting score.");
  const target: EvaluationTarget = { actorId, allianceId: input.allianceId, memberId: null, scope: "batch" };
  const receiptKey = (digest: string) => hash([digest, actorId, input.allianceId, input.periodId,
    input.attemptIds, [...input.excluded].sort(), input.week, input.captureDate, input.dailyMetric, input.weeklyMetric, ...(picks.length ? [[...picks].sort()] : [])]);
  // A successfully saved batch may itself change the roster. Recover its
  // receipt after a lost response before attempting to rematch old evidence.
  if (decision && /^[a-f0-9]{64}$/.test(decision.comparison)) {
    const receipt = await prisma.$transaction(async tx => {
      await batchWriteContext(tx, target);
      return tx.ocrScoreBatch.findFirst({ where: { confirmationDigest: receiptKey(decision.comparison), actorId,
        allianceId: input.allianceId }, select: { id: true, periodId: true, excludedRows: true,
        entries: { select: { allianceMemberId: true, allianceMember: { select: { playerName: true } },
          metricId: true, metric: { select: { name: true } }, value: true, ocrCreatedRosterMember: true,
          ocrSources: { select: { window: true }, take: 1 } } } } });
    });
    if (receipt) return { changes: [] as string[], periodName: "", periodId: receipt.periodId, batchId: receipt.id, comparison: decision.comparison, saved: true, excluded: receipt.excludedRows,
      comparisons: receipt.entries.map(e => ({ memberId: e.allianceMemberId, member: e.allianceMember.playerName,
        metricId: e.metricId, metric: e.metric.name, value: e.value!, window: e.ocrSources[0].window,
        createMember: e.ocrCreatedRosterMember, previous: null, previousId: null })) };
  }
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
  const groups = resolveRankingChoices(reconcileOverlap(candidates, true), picks);
  if (picks.some(id => !groups.some(g => !g.conflict && g.choices.some(r => rowId(r) === id)))) fail("Review the conflicting readings and choose one source per score.");
  const excluded = new Set(input.excluded);
  if (input.excluded.some(key => !groups.some(({row}) => rowId(row) === key))) fail("The reviewed rows changed. Review this batch again.");
  const chosen = groups.filter(({row}) => !excluded.has(rowId(row)));
  if (!chosen.length || chosen.length > 300) fail("Choose between one and 300 matched scores.");
  for (const { row, conflict, createMember } of chosen) {
    if (conflict || (!createMember && (!row.memberId || row.status !== "exact")) || row.value === null || row.value > 2147483647)
      fail("Exclude unresolved rows or conflicting scores before saving.");
  }
  const excludedCount = excluded.size + chosen.reduce((total, group) => total + group.ignored, 0);
  const metricFor = (r: BatchCandidate) => r.window!.startsWith("week:") ? input.weeklyMetric : input.dailyMetric;
  const sourceKey = [input.allianceId, input.periodId, chosen.flatMap(g => g.sources.map(r => JSON.stringify([rowId(r), r.memberId, r.window, r.value, metricFor(r)]))).sort()];
  return prisma.$transaction(async tx => {
    const current = await batchWriteContext(tx, target);
    const attempts = await tx.ocrEvaluationAttempt.findMany({ where: { id: { in: input.attemptIds }, allianceId: input.allianceId, memberId: null, status: "READY", expiresAt: { gt: new Date() } },
      select: { contextKey: true } });
    if (attempts.length !== input.attemptIds.length || attempts.some(a => a.contextKey !== current.contextKey)) fail("The roster, permission or source changed. Review the batch again.");
    if (current.actorRole === "MEMBER") fail("Import access is required.");
    const plan = await planBatchDestination(tx,input,chosen.map(g=>g.row.window!),current.actorRole);
    const batchId = hash(sourceKey);
    const slots = chosen.map(({ row, createMember }) => {
      const weekly = row.window!.startsWith("week:");
      const day = weekly ? row.window!.slice(5) : row.window!;
      const metric = plan.metrics.find(m => m.daily !== weekly)!;
      return { createMember, memberId: createMember ? "new:" + exactNameKey(row.sourceName) : row.memberId!, metricId: metric.id, day: weekly ? null : day, metric: metric.name,
        window: row.window!, member: createMember ? exactNameKey(row.sourceName) : row.matchedName!, value: row.value! };
    });
    // Lock destination members in a consistent order. The score-entry FK also
    // locks these records for manual/spreadsheet writers.
    await tx.$queryRaw`SELECT id FROM "AllianceMember" WHERE "allianceId"=${input.allianceId}
      AND id IN (${Prisma.join([...new Set(slots.map(s => s.memberId))])}) ORDER BY id FOR UPDATE`;
    const prior = await tx.$queryRaw<Array<{ memberId: string; metricId: string; day: string | null; id: string; value: number | null }>>`
      SELECT s."memberId", s."metricId", s.day, e.id, e.value FROM jsonb_to_recordset(${JSON.stringify(slots)}::jsonb)
        AS s("memberId" text,"metricId" text,day text) JOIN LATERAL (
        SELECT id,value FROM "MemberMetricEntry" WHERE "periodId"=${plan.periodId ?? null} AND "metricId"=s."metricId" AND "allianceMemberId"=s."memberId"
        AND "observedOn" IS NOT DISTINCT FROM s.day::date ORDER BY "recordedAt" DESC,"createdAt" DESC,id DESC LIMIT 1
      ) e ON true`;
    const comparisons: ScoreComparison[] = slots.map(s => {
      const old = prior.find(p => p.memberId === s.memberId && p.metricId === s.metricId && p.day === s.day);
      return { createMember: s.createMember, memberId: s.memberId, metricId: s.metricId, member: s.member, metric: s.metric, window: s.window, value: s.value, previous: old?.value ?? null, previousId: old?.id ?? null };
    });
    const comparison = hash([batchId, actorId, current.contextKey, current.consent.processing?.id, plan, comparisons]);
    const response = { periodName: plan.name, periodId: plan.periodId, changes: plan.changes, batchId, comparison, comparisons, excluded: excludedCount, saved: false };
    const existing = await tx.ocrScoreBatch.findUnique({ where: { id: batchId } });
    if (existing) return { ...response, excluded: existing.excludedRows, saved: true };
    const used = await tx.ocrScoreSource.findMany({ where: { attemptId: { in: input.attemptIds } }, select: { attemptId: true, rowKey: true } });
    const usedKeys = new Set(used.map(s => s.attemptId + ":" + s.rowKey));
    if (chosen.some(g => g.sources.some(r => usedKeys.has(rowId(r))))) fail("Some source rows were already saved. Exclude those rows and review the remaining scores.");
    if (!decision) return response;
    if (comparison !== decision.comparison) fail("The scores or review context changed. Close this dialog and review the current values.");
    if (comparisons.some(r => r.previous !== null && r.value < r.previous) && decision.lowerConfirmed !== true) fail("Confirm the lower scores before applying this batch.");
    const newNames = [...new Set(slots.filter(s => s.createMember).map(s => s.member))];
    if (newNames.length && decision.createMembersConfirmed !== true) fail("Confirm the new roster members before saving.");
    const provenance = await metricEntryProvenance(tx, input.allianceId, actorId, "OCR_SCREENSHOT");
    const destination = await applyBatchDestination(tx,input.allianceId,plan);
    await tx.ocrScoreBatch.create({ data: { id: batchId, confirmationDigest: receiptKey(comparison), allianceId: input.allianceId, actorId, periodId: destination.periodId, excludedRows: excludedCount } });
    const created = newNames.length ? await tx.allianceMember.createManyAndReturn({
      data: newNames.map(playerName => ({ allianceId: input.allianceId, playerName })),
      select: { id: true, playerName: true },
    }) : [];
    const newIds = new Map(created.map(m => [m.playerName, m.id]));
    const entries = slots.map(s => ({ ...provenance, id: randomUUID(), ocrBatchId: batchId, periodId: destination.periodId, metricId: destination.ids.get(s.metricId)!,
      ocrCreatedRosterMember: s.createMember, allianceMemberId: newIds.get(s.member) ?? s.memberId, value: s.value, observedOn: s.day ? new Date(s.day) : null,
      observationGrain: s.day ? "DAILY_OBSERVATION" as const : "PERIOD_VALUE" as const }));
    await tx.memberMetricEntry.createMany({ data: entries });
    await tx.ocrScoreSource.createMany({ data: chosen.flatMap((g, i) => g.sources.map(r => ({
      entryId: entries[i].id, attemptId: r.attemptId, rowKey: r.key, window: r.window!,
    }))) });
    await touchAllianceSetupActivity(tx, input.allianceId);
    return { ...response, periodId: destination.periodId, comparisons: comparisons.map(r => ({ ...r, metricId: destination.ids.get(r.metricId)!, memberId: newIds.get(r.member) ?? r.memberId })), saved: true };
  }, { isolationLevel: "Serializable", timeout: 15000 });
}
