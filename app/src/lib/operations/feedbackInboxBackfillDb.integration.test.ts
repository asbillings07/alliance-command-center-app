import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  buildFeedbackInboxBackfillManifest,
  listFeedbackInboxBackfillRows,
  planFeedbackInboxBackfill,
  resolveBackfillTargetIdentity,
  runFeedbackInboxBackfill,
  validateFeedbackInboxBackfillCompletion,
} from "./feedbackInboxBackfillDb";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration("feedbackInboxBackfillDb [integration]", () => {
  const createdFeedbackIds: string[] = [];
  const createdUserIds: string[] = [];

  let prisma: PrismaClient;
  let dbIdentity: string;

  beforeAll(async () => {
    ({ prisma } = (await import("../prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ identity: dbIdentity } = resolveBackfillTargetIdentity());
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

  async function manifestForCurrentRows() {
    const rows = await listFeedbackInboxBackfillRows(prisma);
    const plan = planFeedbackInboxBackfill(rows);
    return buildFeedbackInboxBackfillManifest({
      dbIdentity,
      totalFeedbackRows: rows.length,
      plan,
    });
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

    const manifest = await manifestForCurrentRows();

    const firstExecute = await runFeedbackInboxBackfill(prisma, {
      dryRun: false,
      approvedManifest: manifest,
    });
    expect(firstExecute.allianceIdApplied).toBe(1);
    expect(firstExecute.triageProjectionsApplied).toBe(1);
    expect(firstExecute.validation.ok).toBe(true);

    const secondExecute = await runFeedbackInboxBackfill(prisma, {
      dryRun: false,
      approvedManifest: manifest,
    });
    expect(secondExecute.allianceIdApplied).toBe(0);
    expect(secondExecute.triageProjectionsApplied).toBe(0);
    expect(secondExecute.validation.ok).toBe(true);
    expect(secondExecute.allianceIdSkippedNoSegment).toBeGreaterThanOrEqual(1);
  });

  it("refuses execute when live plan drifted from approved manifest", async () => {
    const feedback = await seedLegacyFeedback({
      url: "/alliances/alliance-a/members",
      withTriage: false,
    });
    const manifest = buildFeedbackInboxBackfillManifest({
      dbIdentity,
      totalFeedbackRows: 1,
      plan: planFeedbackInboxBackfill([
        {
          id: feedback.id,
          url: feedback.url,
          allianceId: null,
          hasTriage: false,
        },
      ]),
    });

    await prisma.feedback.update({
      where: { id: feedback.id },
      data: { url: "/alliances/alliance-b/members" },
    });

    await expect(
      runFeedbackInboxBackfill(prisma, {
        dryRun: false,
        approvedManifest: manifest,
      }),
    ).rejects.toThrow(/checksum does not match/);
  });

  it("converges when a concurrent app write sets allianceId before backfill runs", async () => {
    const feedback = await seedLegacyFeedback({
      url: "/alliances/alliance-a/members",
      withTriage: false,
    });
    const manifest = buildFeedbackInboxBackfillManifest({
      dbIdentity,
      totalFeedbackRows: 1,
      plan: planFeedbackInboxBackfill([
        {
          id: feedback.id,
          url: feedback.url,
          allianceId: null,
          hasTriage: false,
        },
      ]),
    });

    await prisma.feedback.update({
      where: { id: feedback.id },
      data: { allianceId: "alliance-a" },
    });

    const result = await runFeedbackInboxBackfill(prisma, {
      dryRun: false,
      approvedManifest: manifest,
    });
    expect(result.allianceIdApplied).toBe(0);
    expect(result.triageProjectionsApplied).toBe(1);
    expect(result.validation.ok).toBe(true);
  });

  it("resumes cleanly after an interrupted execute", async () => {
    await seedLegacyFeedback({
      url: "/alliances/alliance-a/members",
      withTriage: false,
    });
    const manifest = await manifestForCurrentRows();

    let writes = 0;
    await expect(
      runFeedbackInboxBackfill(prisma, {
        dryRun: false,
        approvedManifest: manifest,
        hooks: {
          afterRowWrite: async () => {
            writes += 1;
            if (writes === 1) {
              throw new Error("simulated interruption");
            }
          },
        },
      }),
    ).rejects.toThrow("simulated interruption");

    const resumed = await runFeedbackInboxBackfill(prisma, {
      dryRun: false,
      approvedManifest: manifest,
    });
    expect(resumed.validation.ok).toBe(true);
  });

  it("post-run validation catches a manufactured violation", async () => {
    const feedback = await seedLegacyFeedback({
      url: "/alliances/alliance-a/members",
      withTriage: false,
    });
    const manifest = buildFeedbackInboxBackfillManifest({
      dbIdentity,
      totalFeedbackRows: 1,
      plan: planFeedbackInboxBackfill([
        {
          id: feedback.id,
          url: feedback.url,
          allianceId: null,
          hasTriage: false,
        },
      ]),
    });

    const validation = await validateFeedbackInboxBackfillCompletion(prisma, manifest);
    expect(validation.ok).toBe(false);
    expect(validation.violations.some((v) => v.includes("allianceId"))).toBe(true);
  });
});
