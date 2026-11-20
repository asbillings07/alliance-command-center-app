import "server-only";
import { notFound } from "next/navigation";
import { requirePlatformAdmin } from "../auth/requirePlatformAdmin";
import { originalOcrAllowanceDatabase } from "../ocr/deploymentIsolation";
import { thursdayFixLiveAt, type ActivityRow } from "./ocrPilotActivity";

function count(value: unknown): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) throw Error();
  return value;
}

function date(value: unknown): Date {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw Error();
  return new Date(value);
}

function activityRow(value: Record<string, unknown>): ActivityRow {
  const { id, firstId, status, outcome, retry, automaticRetry } = value;
  if (typeof id !== "string" || !/^\d{8}$/.test(id) || typeof firstId !== "string" || !/^\d{8}$/.test(firstId)
    || (status !== "READY" && status !== "FAILED" && status !== "PROCESSING")
    || !(outcome === null || (typeof outcome === "string" && /^(alliance-|processing-failed:)[a-z-]{1,36}$/.test(outcome)))
    || typeof retry !== "boolean" || typeof automaticRetry !== "boolean") throw Error();
  return { id, firstId, status, outcome, retry, automaticRetry, createdAt: date(value.createdAt),
    scores: count(value.scores), lastSavedAt: value.lastSavedAt === null ? null : date(value.lastSavedAt) };
}

/** Per-deployment readout. No production credentials, files, identities or recognized content. */
export async function getQaWordSnapshot(sinceFix: boolean) {
  await requirePlatformAdmin();
  if (!originalOcrAllowanceDatabase(process.env)
    || process.env.VERCEL_GIT_COMMIT_REF !== "codex/platform-ocr-attempt-history") notFound();
  const raw = process.env.OCR_QA_WORD_ACTIVITY;
  if (!raw || raw.length > 16000) notFound();
  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.activity) || data.activity.length > 20) throw Error();
    const rows: ActivityRow[] = data.activity.map(activityRow);
    const since = Date.parse(thursdayFixLiveAt);
    return {
      capturedAt: date(data.capturedAt).toISOString(), scans: count(data.scans), retries: count(data.retries),
      failures: count(data.failures), saves: count(data.saves), confirmedScores: count(data.confirmedScores),
      activity: rows.filter(row => !sinceFix || row.createdAt.getTime() >= since || (row.lastSavedAt?.getTime() ?? 0) >= since),
    };
  } catch { notFound(); }
}
