import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import type { Prisma, PrismaClient } from "@/app/generated/prisma/client";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §4: every writer that touches MetricPeriod and also
// calls touchAllianceSetupActivity in the same transaction must acquire the
// MetricPeriod-affecting lock strictly before the Alliance lock. This is the
// actual deadlock-safety invariant (not "no second lock") - proven here
// against the same MetricPeriod row and the same Alliance row, since two
// different periods would let the transactions serialize purely on Alliance
// without ever contending on MetricPeriod.
describe.skipIf(!runDb)("MetricPeriod-then-Alliance lock ordering [integration]", () => {
  let prisma: PrismaClient;
  let editMetricPeriod: (formData: FormData) => Promise<{ success: boolean; error?: string }>;
  let touchAllianceSetupActivity: (
    tx: Prisma.TransactionClient,
    allianceId: string,
  ) => Promise<void>;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ editMetricPeriod } = await import("@/app/alliances/[allianceId]/periods/action"));
    ({ touchAllianceSetupActivity } = await import("@/app/src/lib/touchAllianceSetupActivity"));
  });

  beforeEach(async () => {
    vi.resetAllMocks();
    const { requireAllianceAccess } = await import("@/app/src/lib/auth/requireAllianceAccess");
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      user: { id: "integration-test-user", email: "test@local" },
      permissions: { canConfigurePeriods: true } as unknown as Awaited<
        ReturnType<typeof requireAllianceAccess>
      >["permissions"],
      membership: { role: "ADMIN" } as unknown as Awaited<
        ReturnType<typeof requireAllianceAccess>
      >["membership"],
    });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMember: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriodMetric.deleteMany({
        where: { period: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeSetup() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Lock Ordering Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });

    const period = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "Week 1",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-01-07T23:59:59.999Z"),
      },
    });

    const metric = await prisma.metric.create({
      data: {
        allianceId: alliance.id,
        name: "Daily VS",
        type: "NUMERIC",
        observationGrain: "DAILY_OBSERVATION",
        memberPeriodRollup: "SUM",
      },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    return { alliance, member, period, metric };
  }

  function buildEditFormData(fields: {
    periodId: string;
    allianceId: string;
    name: string;
    startsAt: string;
    endsAt: string;
  }): FormData {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      formData.set(key, value);
    }
    return formData;
  }

  // (a) Regression baseline: a simulated daily-observation write (record/
  // action.ts's daily-entry capability is a later #287 slice, so this
  // exercises the same real triggers and the real touchAllianceSetupActivity
  // helper directly, matching the transaction shape that writer will use)
  // races a real editMetricPeriod boundary edit on the SAME period and the
  // SAME alliance row. The edit deliberately narrows the period to days 5-7,
  // excluding day 4 - the date the simulated insert targets - so exactly one
  // of the two can legitimately commit, never both and never a hang,
  // regardless of which one wins the MetricPeriod lock first.
  it("resolves to exactly one commit, never a hang, when a daily insert and a boundary edit race on the same period and alliance", async () => {
    const { alliance, member, period, metric } = await makeSetup();

    const simulatedDailyInsert = prisma.$transaction(async (tx) => {
      await tx.memberMetricEntry.create({
        data: {
          allianceMemberId: member.id,
          periodId: period.id,
          metricId: metric.id,
          observationGrain: "DAILY_OBSERVATION",
          observedOn: new Date("2026-01-04T00:00:00.000Z"),
          value: 10,
          status: "ACTIVE",
        },
      });
      await touchAllianceSetupActivity(tx, alliance.id);
    });

    const boundaryEdit = editMetricPeriod(
      buildEditFormData({
        periodId: period.id,
        allianceId: alliance.id,
        name: "Week 1",
        startsAt: "2026-01-05",
        endsAt: "2026-01-07",
      }),
    );

    const [insertResult, editResult] = await Promise.allSettled([simulatedDailyInsert, boundaryEdit]);

    const insertSucceeded = insertResult.status === "fulfilled";
    const editSucceeded = editResult.status === "fulfilled" && editResult.value.success;

    // Exactly one side wins - if the insert commits first, 4b's EXISTS check
    // then rejects the edit; if the edit commits first, 4c re-validates the
    // insert against the new, narrower range and rejects it.
    expect(insertSucceeded).not.toBe(editSucceeded);
  }, 15_000);

  // (b) Hazard canary: two sessions manually driven through the two possible
  // lock orderings on the SAME MetricPeriod row and the SAME Alliance row.
  // One follows this design's required MetricPeriod-then-Alliance order; the
  // other is deliberately driven Alliance-then-MetricPeriod (the order every
  // real writer in §8's inventory avoids). If a future writer ever reversed
  // this order, it would reproduce exactly this deadlock.
  it("deadlocks (and Postgres aborts one side) when one session is driven in the forbidden Alliance-then-MetricPeriod order", async () => {
    const { alliance, period } = await makeSetup();

    const correctOrder = prisma.$transaction(async (tx) => {
      await tx.$queryRawUnsafe('SELECT id FROM "MetricPeriod" WHERE id = $1 FOR SHARE', period.id);
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.$executeRawUnsafe(
        'UPDATE "Alliance" SET "setupActivityAt" = now() WHERE id = $1',
        alliance.id,
      );
    });

    const forbiddenOrder = prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(
        'UPDATE "Alliance" SET "setupActivityAt" = now() WHERE id = $1',
        alliance.id,
      );
      await new Promise((resolve) => setTimeout(resolve, 300));
      await tx.$executeRawUnsafe('UPDATE "MetricPeriod" SET name = name WHERE id = $1', period.id);
    });

    const results = await Promise.allSettled([correctOrder, forbiddenOrder]);
    const rejections = results.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );

    // At least one side must be aborted by Postgres's deadlock detector -
    // both sides succeeding would mean no cycle ever formed, which would
    // mean this canary failed to exercise the hazard at all.
    expect(rejections.length).toBeGreaterThanOrEqual(1);
    expect(String(rejections[0].reason)).toMatch(/deadlock detected/i);
  }, 15_000);
});
