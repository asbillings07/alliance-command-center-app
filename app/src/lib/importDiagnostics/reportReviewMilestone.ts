"use client";
import { recordReviewMilestone } from "./reviewAction";
import type { ReviewStage } from "./reviewStages";

export function reportReviewMilestone(allianceId: string, attemptIds: string[], interactionId: string, stage: ReviewStage) {
  void recordReviewMilestone(allianceId, attemptIds, interactionId, stage, process.env.NEXT_PUBLIC_APP_BUILD).catch(() => {});
}
