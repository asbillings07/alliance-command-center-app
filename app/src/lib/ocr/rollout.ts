import "server-only";
import { evaluateFeature } from "../featureFlags/evaluateFeature";
import { resolveEnvironment } from "../featureFlags/context";
import { OcrEvaluationError, requireOcrEvaluation } from "./config";

/** IDs must come from the DB-authorized OCR context, never raw route/body values. */
export async function requireOcrRollout(identity: { userId: string; allianceId: string }) {
  requireOcrEvaluation(identity.allianceId);
  let enabled = false;
  try {
    enabled = await evaluateFeature("ocr-screenshot-evaluation", {
      environment: resolveEnvironment(), userId: identity.userId, alliance: { id: identity.allianceId },
    });
  } catch { /* Exhausted resolution/configuration failures stay closed; never log identities. */ }
  if (enabled !== true) throw new OcrEvaluationError(
    "Screenshot evaluation is unavailable for this account and alliance. No new scan will start.", "rollout-disabled");
}
