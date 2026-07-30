import { describe, it, expect, beforeAll, afterEach, afterAll } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { createIsolatedIntegrationDatabase } from "./testing/isolatedIntegrationDatabase";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration("FeedbackTriageEvent CHECK constraints [integration]", () => {
  let isolated: Awaited<ReturnType<typeof createIsolatedIntegrationDatabase>>;
  let prisma: PrismaClient;
  let feedbackId: string;
  let actorUserId: string;

  beforeAll(async () => {
    isolated = await createIsolatedIntegrationDatabase("feedback-triage-checks");
    prisma = isolated.prisma;

    const user = await prisma.user.create({
      data: {
        email: `check-constraints-${Date.now()}@example.test`,
        displayName: "Check Actor",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    actorUserId = user.id;

    const feedback = await prisma.feedback.create({
      data: {
        userId: user.id,
        submitterEmail: user.email,
        submitterDisplayName: user.displayName,
        category: "BUG",
        message: "check constraint test",
        url: "/platform/overview",
      },
    });
    feedbackId = feedback.id;
  });

  afterEach(async () => {
    await prisma.feedbackTriageEvent.deleteMany({ where: { feedbackId } });
  });

  afterAll(async () => {
    await isolated.dispose();
  });

  it("rejects an event with no real change columns set", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "FeedbackTriageEvent" (
          "id", "feedbackId", "actorUserId", "actorEmail", "createdAt",
          "githubIssueUrlChanged"
        ) VALUES (
          ${`evt-empty-${Date.now()}`}, ${feedbackId}, ${actorUserId},
          'actor@example.test', NOW(), false
        )
      `,
    ).rejects.toThrow();
  });

  it("rejects githubIssueUrlChangedTo set while githubIssueUrlChanged is false", async () => {
    await expect(
      prisma.$executeRaw`
        INSERT INTO "FeedbackTriageEvent" (
          "id", "feedbackId", "actorUserId", "actorEmail", "createdAt",
          "githubIssueUrlChanged", "githubIssueUrlChangedTo"
        ) VALUES (
          ${`evt-github-flag-${Date.now()}`}, ${feedbackId}, ${actorUserId},
          'actor@example.test', NOW(), false,
          'https://github.com/org/repo/issues/1'
        )
      `,
    ).rejects.toThrow();
  });

  it("allows pre-cutover Feedback INSERT shape that omits submitter snapshot columns", async () => {
    const legacyUser = await prisma.user.create({
      data: {
        email: `legacy-insert-${Date.now()}@example.test`,
        displayName: "Legacy Insert User",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });

    const legacyFeedbackId = `legacy-fb-${Date.now()}`;
    await prisma.$executeRaw`
      INSERT INTO "Feedback" (
        "id", "userId", "category", "message", "url", "createdAt"
      ) VALUES (
        ${legacyFeedbackId},
        ${legacyUser.id},
        'BUG'::"FeedbackCategory",
        'submitted during deploy overlap',
        '/platform/overview',
        NOW()
      )
    `;

    const row = await prisma.feedback.findUniqueOrThrow({
      where: { id: legacyFeedbackId },
      include: { user: { select: { email: true, displayName: true } } },
    });
    expect(row.submitterEmail).toBeNull();
    expect(row.submitterDisplayName).toBeNull();
    expect(row.user?.email).toBe(legacyUser.email);
  });
});
