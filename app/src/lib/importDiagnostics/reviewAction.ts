"use server";

import { auth } from "../auth";
import { prisma } from "../prisma";
import { batchWriteContext } from "../ocr/evaluation";
import { readClientBuild } from "../ocr/clientBuild";
import { reviewStages, type ReviewStage } from "./reviewStages";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function recordReviewMilestone(allianceId: string, attemptIds: string[], interactionId: string, stage: ReviewStage, build?: string) {
  if (typeof allianceId !== "string" || !allianceId || allianceId.length > 96 ||
      typeof stage !== "string" || !Object.hasOwn(reviewStages, stage) ||
      typeof interactionId !== "string" || !uuid.test(interactionId) ||
      !Array.isArray(attemptIds) || !attemptIds.length || attemptIds.length > 20 ||
      !attemptIds.every(id => typeof id === "string" && uuid.test(id)) || new Set(attemptIds).size !== attemptIds.length) return;
  const actorId = (await auth())?.user?.id;
  if (!actorId) return;
  await prisma.$transaction(async tx => {
    await batchWriteContext(tx, { allianceId, actorId, memberId: null, scope: "batch" });
    const count = await tx.ocrEvaluationAttempt.count({
      where: { allianceId, memberId: null, id: { in: attemptIds }, status: "READY", expiresAt: { gt: new Date() } },
    });
    if (count !== attemptIds.length) return;
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${actorId}, 424))`;
    if (stage === "confirmation_dismissed") {
      const opened = await tx.ocrReviewMilestone.findFirst({ where: {
        actorId, allianceId, interactionId, stage: "score_displayed", attemptIds: { equals: attemptIds },
      }, select: { id: true } });
      if (!opened) return;
    }
    const recent = await tx.ocrReviewMilestone.count({ where: { actorId, createdAt: { gte: new Date(Date.now() - 60000) } } });
    if (recent >= 60) return;
    await tx.ocrReviewMilestone.createMany({ data: {
      allianceId, actorId, attemptIds, interactionId, stage, clientBuild: readClientBuild(build),
    }, skipDuplicates: true });
  });
}
