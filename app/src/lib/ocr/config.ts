import "server-only";
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

export function ocrEvaluationVisible() {
  if (localOcrFixtureEnabled()) return true;
  return process.env.VERCEL_ENV === "preview"
    && process.env.VERCEL_TARGET_ENV === "acc-ocr-eval"
    && OCR_EVALUATION_BRANCHES.includes(process.env.VERCEL_GIT_COMMIT_REF ?? "")
    && process.env.OCR_EVAL_ENABLED === "true";
}

export function requireOcrEvaluation(allianceId: string) {
  if (!ocrEvaluationVisible()) throw new OcrEvaluationError("Screenshot evaluation is not enabled here.");
  // The reviewed preview explicitly disables telemetry rather than relying on
  // SDK defaults to scrub screenshot/request content. Production is untouched.
  if (process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_REPLAY === "true") {
    throw new OcrEvaluationError("Screenshot evaluation is awaiting its privacy configuration.");
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
  if (process.env.VERCEL_ENV !== "preview" || process.env.VERCEL_TARGET_ENV !== "acc-ocr-eval" || project !== "project-106f8c4e-a31b-4e3c-bc5"
    || !bucket?.startsWith("acc-ocr-eval-") || !/^[a-z0-9-]{10,63}$/.test(bucket)
    || projectNumber !== "735932937321"
    || serviceAccount !== `acc-ocr-eval@${project}.iam.gserviceaccount.com`) {
    throw new OcrEvaluationError("The OCR provider is not configured. No scan was sent.");
  }
  return { project, bucket, projectNumber, serviceAccount };
}
