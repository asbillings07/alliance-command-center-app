"use server";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { OcrEvaluationError } from "@/app/src/lib/ocr/config";
import { reviewOrSaveBatch, type BatchSelection } from "@/app/src/lib/ocr/confirmedBatch";

export async function checkBatch(input: BatchSelection, decision?: { comparison: string; lowerConfirmed: boolean; createMembersConfirmed?: boolean }) {
  const user = await requireAuth();
  try {
    const review = await reviewOrSaveBatch(user.id, input, decision);
    if (review.saved) revalidateAllianceData({ allianceId: input.allianceId, periodId: input.periodId, domains: ["members","dashboard","evaluation-results","reports","setup"] });
    return { review };
  } catch (error) {
    return { error: error instanceof OcrEvaluationError ? error.message : "Could not confirm the batch. Check saved batches and review the latest scores before trying again." };
  }
}
