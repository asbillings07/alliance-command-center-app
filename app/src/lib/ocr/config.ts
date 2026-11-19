import "server-only";
import { productionPilotConfigured, productionPilotPairs } from "./productionPilot";
import { OCR_EVALUATION_BRANCHES } from "./evaluationBranches";

export const OCR_CAMPAIGN = "acc-managed-ocr-v1";
export const OCR_VERSION = "daily-vs-evaluation-v1";
export const OCR_RESERVATION_MICROS = 10_000;
export const OCR_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const OCR_MAX_INPUT_BYTES = 2 * 1024 * 1024;
export const OCR_MAX_IMAGE_BYTES = 1024 * 1024;
export const OCR_MAX_RESULT_BYTES = 64 * 1024;

export class OcrEvaluationError extends Error {
  constructor(message: string, readonly outcome?: string) { super(message); }
}

export function localOcrFixtureEnabled() {
  return !process.env.VERCEL && !process.env.VERCEL_ENV
    && process.env.ACC_E2E_MODE === "1" && process.env.OCR_EVAL_TEST_FIXTURE === "1";
}

export function ocrPreferencesAvailable(userId?: string) {
  if (process.env.VERCEL_ENV === "production") return productionPilotConfigured() && (userId === undefined || productionPilotPairs().some(pair => pair.userId === userId));
  if (localOcrFixtureEnabled()) return true;
  return process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_TARGET_ENV === "acc-ocr-eval"
    && OCR_EVALUATION_BRANCHES.includes(process.env.VERCEL_GIT_COMMIT_REF ?? "");
}

export function ocrEvaluationVisible() {
  return localOcrFixtureEnabled() || (ocrPreferencesAvailable() && process.env.OCR_EVAL_ENABLED === "true");
}

export function requireOcrEvaluation(allianceId: string) {
  if (!ocrEvaluationVisible()) throw new OcrEvaluationError("Screenshot evaluation is not enabled here.");
  // The reviewed preview explicitly disables telemetry rather than relying on
  // SDK defaults to scrub screenshot/request content. The live pilot filters server events and disallows browser telemetry.
  if ((process.env.SENTRY_DSN && !productionPilotConfigured()) || process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_REPLAY === "true") {
    throw new OcrEvaluationError("Screenshot evaluation is awaiting its privacy configuration.");
  }
  if (process.env.VERCEL_ENV === "production") {
    if (!productionPilotPairs().some(pair => pair.allianceId === allianceId)) throw new OcrEvaluationError("Screenshot evaluation is unavailable for this alliance.");
    return;
  }
  if (!localOcrFixtureEnabled() && !(process.env.OCR_EVAL_ALLIANCE_IDS ?? "").split(",").includes(allianceId)) {
    throw new OcrEvaluationError("Screenshot evaluation is not enabled for this alliance.");
  }
}

export function googleOcrConfig() {
  const project = process.env.OCR_GCP_PROJECT;
  const bucket = process.env.OCR_GCS_BUCKET;
  const projectNumber = process.env.OCR_GCP_PROJECT_NUMBER;
  const serviceAccount = process.env.OCR_GCP_SERVICE_ACCOUNT;
  // Pin both identifiers to the owner-selected Aptelum project. Switching the
  // provider must not silently switch the federation trust or billing project.
  const pilot = productionPilotConfigured();
  const account = pilot ? "acc-ocr-word-pilot" : "acc-ocr-eval";
  const validDestination = pilot ? bucket === "acc-ocr-word-pilot-735932937321"
    : process.env.VERCEL_ENV === "preview" && process.env.VERCEL_TARGET_ENV === "acc-ocr-eval" && bucket?.startsWith("acc-ocr-eval-");
  if (!validDestination || project !== "project-106f8c4e-a31b-4e3c-bc5"
    || !bucket || !/^[a-z0-9-]{10,63}$/.test(bucket)
    || projectNumber !== "735932937321"
    || serviceAccount !== `${account}@${project}.iam.gserviceaccount.com`) {
    throw new OcrEvaluationError("The OCR provider is not configured. No scan was sent.");
  }
  return { project, bucket, projectNumber, serviceAccount, providerPath: pilot ? "acc-ocr-word-pilot/providers/vercel-production" : "acc-ocr-eval/providers/vercel-preview" };
}
