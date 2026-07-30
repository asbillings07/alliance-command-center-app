import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  buildFeedbackInboxBackfillManifest,
  listFeedbackInboxBackfillRows,
  planFeedbackInboxBackfill,
  resolveBackfillTargetIdentity,
  resolveFeedbackInboxBackfillDryRun,
  runFeedbackInboxBackfill,
  validateFeedbackInboxBackfillCompletion,
} from "./feedbackInboxBackfillDb";
import { resolveFeedbackSubmitterIdentity } from "../feedback";

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

  async function rowsForFeedbackIds(ids: string[]) {
    const rows = await listFeedbackInboxBackfillRows(prisma);
    return rows.filter((row) => ids.includes(row.id));
  }

  async function seedOverlapWindowFeedback() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `overlap-${suffix}@example.test`,
        displayName: "Overlap Window User",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);

    const feedbackId = `overlap-fb-${suffix}`;
    await prisma.$executeRaw`
      INSERT INTO "Feedback" (
        "id", "userId", "category", "message", "url", "createdAt"
      ) VALUES (
        ${feedbackId},
        ${user.id},
        'BUG'::"FeedbackCategory",
        'submitted during deploy overlap',
        '/platform/overview',
        NOW()
      )
    `;
    createdFeedbackIds.push(feedbackId);
    return { feedbackId, user };
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
      plan: planFeedbackInboxBackfill(await rowsForFeedbackIds([feedback.id])),
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
    ).rejects.toThrow(/Refusing to execute:.*(checksum does not match|URL drifted since the dry run)/);
  });

  it("converges when a concurrent app write sets allianceId before backfill runs", async () => {
    const feedback = await seedLegacyFeedback({
      url: "/alliances/alliance-a/members",
      withTriage: false,
    });
    const manifest = buildFeedbackInboxBackfillManifest({
      dbIdentity,
      totalFeedbackRows: 1,
      plan: planFeedbackInboxBackfill(await rowsForFeedbackIds([feedback.id])),
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
      plan: planFeedbackInboxBackfill(await rowsForFeedbackIds([feedback.id])),
    });

    const validation = await validateFeedbackInboxBackfillCompletion(prisma, manifest);
    expect(validation.ok).toBe(false);
    expect(validation.violations.some((v) => v.includes("allianceId"))).toBe(true);
  });

  it("dry-run uses a single feedback findMany read", async () => {
    let findManyCalls = 0;
    const trackingDb = {
      feedback: {
        findMany: async (...args: unknown[]) => {
          findManyCalls += 1;
          return prisma.feedback.findMany(...(args as Parameters<typeof prisma.feedback.findMany>));
        },
      },
    };

    const dryRun = await resolveFeedbackInboxBackfillDryRun(trackingDb);
    expect(findManyCalls).toBe(1);
    expect(dryRun.summary.dryRun).toBe(true);
    expect(dryRun.summary.totalFeedbackRows).toBe(dryRun.rows.length);
    expect(dryRun.summary.allianceIdUpdates).toBe(dryRun.plan.summary.allianceIdUpdates);
  });

  it("backfill preserves submitter snapshot for overlap-window row before user deletion", async () => {
    const { feedbackId, user } = await seedOverlapWindowFeedback();

    const beforeBackfill = await prisma.feedback.findUniqueOrThrow({
      where: { id: feedbackId },
    });
    expect(beforeBackfill.submitterEmail).toBeNull();
    expect(beforeBackfill.submitterDisplayName).toBeNull();

    const manifest = await manifestForCurrentRows();
    expect(manifest.plan.submitterSnapshotUpdates).toEqual(
      expect.arrayContaining([
        {
          id: feedbackId,
          submitterEmail: user.email,
          submitterDisplayName: user.displayName,
        },
      ]),
    );

    const executed = await runFeedbackInboxBackfill(prisma, {
      dryRun: false,
      approvedManifest: manifest,
    });
    expect(executed.submitterSnapshotApplied).toBeGreaterThanOrEqual(1);
    expect(executed.validation.ok).toBe(true);

    const afterBackfill = await prisma.feedback.findUniqueOrThrow({
      where: { id: feedbackId },
    });
    expect(afterBackfill.submitterEmail).toBe(user.email);
    expect(afterBackfill.submitterDisplayName).toBe(user.displayName);

    await prisma.user.delete({ where: { id: user.id } });
    createdUserIds.splice(createdUserIds.indexOf(user.id), 1);

    const afterUserDeletion = await prisma.feedback.findUniqueOrThrow({
      where: { id: feedbackId },
    });
    expect(afterUserDeletion.userId).toBeNull();
    expect(afterUserDeletion.submitterEmail).toBe(user.email);
    expect(afterUserDeletion.submitterDisplayName).toBe(user.displayName);
    expect(
      resolveFeedbackSubmitterIdentity({
        submitterEmail: afterUserDeletion.submitterEmail,
        submitterDisplayName: afterUserDeletion.submitterDisplayName,
        user: null,
      }),
    ).toEqual({
      email: user.email,
      displayName: user.displayName,
    });
  });

  it("post-run validation reports backfillable null submitter snapshots", async () => {
    const { feedbackId } = await seedOverlapWindowFeedback();
    const manifest = buildFeedbackInboxBackfillManifest({
      dbIdentity,
      totalFeedbackRows: 0,
      plan: planFeedbackInboxBackfill([]),
    });

    const validation = await validateFeedbackInboxBackfillCompletion(prisma, manifest);
    expect(validation.ok).toBe(false);
    expect(
      validation.violations.some(
        (v) => v.includes("null submitterEmail with a non-null userId") && v.includes(feedbackId),
      ),
    ).toBe(true);
  });
});
