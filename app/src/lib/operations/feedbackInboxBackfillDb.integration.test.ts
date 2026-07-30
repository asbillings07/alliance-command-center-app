import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { runFeedbackInboxBackfill } from "./feedbackInboxBackfillDb";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration("feedbackInboxBackfillDb [integration]", () => {
  const createdFeedbackIds: string[] = [];
  const createdUserIds: string[] = [];

  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = (await import("../prisma")) as unknown as {
      prisma: PrismaClient;
    });
  });

  afterEach(async () => {
    if (createdFeedbackIds.length > 0) {
      await prisma.feedbackTriage.deleteMany({
        where: { feedbackId: { in: createdFeedbackIds } },
      });
      await prisma.feedback.deleteMany({
        where: { id: { in: createdFeedbackIds } },
      });
      createdFeedbackIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  async function seedLegacyFeedback(args: {
    url: string;
    allianceId?: string | null;
    withTriage?: boolean;
  }) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `backfill-${suffix}@example.test`,
        displayName: "Backfill User",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);

    const feedback = await prisma.feedback.create({
      data: {
        userId: user.id,
        submitterEmail: user.email,
        submitterDisplayName: user.displayName,
        category: "IDEA",
        message: "legacy row",
        url: args.url,
        allianceId: args.allianceId ?? null,
        ...(args.withTriage === false
          ? {}
          : {
              triage: {
                create: {
                  status: "NEW",
                  needsResponse: true,
                  stateRevision: 0,
                },
              },
            }),
      },
    });
    createdFeedbackIds.push(feedback.id);
    return feedback;
  }

  it("dry-run does not mutate and execute is idempotent", async () => {
    await seedLegacyFeedback({
      url: "/alliances/alliance-a/members",
      withTriage: false,
    });
    await seedLegacyFeedback({
      url: "/platform/overview",
      withTriage: true,
    });

    const dryRun = await runFeedbackInboxBackfill(prisma, { dryRun: true });
    expect(dryRun.allianceIdUpdates).toBe(1);
    expect(dryRun.triageProjectionsCreated).toBe(1);

    const rowBeforeExecute = await prisma.feedback.findFirst({
      where: { url: "/alliances/alliance-a/members" },
      include: { triage: true },
    });
    expect(rowBeforeExecute?.allianceId).toBeNull();
    expect(rowBeforeExecute?.triage).toBeNull();

    const firstExecute = await runFeedbackInboxBackfill(prisma, { dryRun: false });
    expect(firstExecute.allianceIdUpdates).toBe(1);
    expect(firstExecute.triageProjectionsCreated).toBe(1);

    const secondExecute = await runFeedbackInboxBackfill(prisma, { dryRun: false });
    expect(secondExecute.allianceIdUpdates).toBe(0);
    expect(secondExecute.triageProjectionsCreated).toBe(0);
    expect(secondExecute.allianceIdSkippedNoSegment).toBeGreaterThanOrEqual(1);
  });
});
