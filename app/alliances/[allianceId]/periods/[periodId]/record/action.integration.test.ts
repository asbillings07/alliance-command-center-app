import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as RecordAction from "./action";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/cache/revalidateAllianceData", () => ({
  revalidateAllianceData: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("recordMemberMetrics [integration]", () => {
  let prisma: PrismaClient;
  let recordMemberMetrics: typeof RecordAction.recordMemberMetrics;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ recordMemberMetrics } = await import("./action"));
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      user: { id: "integration-test-user", email: "test@local" },
      permissions: { canImportMetrics: true } as unknown as Awaited<
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
      await prisma.allianceMember.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeSetup(metricType: "NUMERIC" | "BOOLEAN") {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Record Action Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Test Player" },
    });

    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Period A" },
    });

    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Metric", type: metricType },
    });

    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });

    return { alliance, member, period, metric };
  }

  it("accepts 0 and 1 for a BOOLEAN metric", async () => {
    const { alliance, member, period, metric } = await makeSetup("BOOLEAN");

    await recordMemberMetrics({
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      entries: [{ memberId: member.id, value: 1 }],
    });

    const entry = await prisma.memberMetricEntry.findFirst({
      where: { periodId: period.id, metricId: metric.id },
    });
    expect(entry?.value).toBe(1);
  });

  it("rejects a non-0/1 value for a BOOLEAN metric with zero writes", async () => {
    const { alliance, member, period, metric } = await makeSetup("BOOLEAN");

    await expect(
      recordMemberMetrics({
        allianceId: alliance.id,
        periodId: period.id,
        metricId: metric.id,
        entries: [{ memberId: member.id, value: 2 }],
      }),
    ).rejects.toThrow("Boolean metric values must be exactly 0 or 1");

    const count = await prisma.memberMetricEntry.count({
      where: { periodId: period.id, metricId: metric.id },
    });
    expect(count).toBe(0);
  });

  it("still accepts arbitrary integers for a NUMERIC metric", async () => {
    const { alliance, member, period, metric } = await makeSetup("NUMERIC");

    await recordMemberMetrics({
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      entries: [{ memberId: member.id, value: 4200 }],
    });

    const entry = await prisma.memberMetricEntry.findFirst({
      where: { periodId: period.id, metricId: metric.id },
    });
    expect(entry?.value).toBe(4200);
  });

  it("revalidates all five observation-changing-write domains (ADR-018), matching the touchAllianceSetupActivity call in the same transaction", async () => {
    const { alliance, member, period, metric } = await makeSetup("NUMERIC");

    await recordMemberMetrics({
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      entries: [{ memberId: member.id, value: 100 }],
    });

    expect(revalidateAllianceData).toHaveBeenCalledWith({
      allianceId: alliance.id,
      periodId: period.id,
      domains: ["members", "dashboard", "setup", "evaluation-results", "reports"],
    });
  });

  it("writes observationGrain from the metric's own grain and status ACTIVE explicitly, never relying on the schema default (ADR-018 §3)", async () => {
    const { alliance, member, period, metric } = await makeSetup("NUMERIC");

    await recordMemberMetrics({
      allianceId: alliance.id,
      periodId: period.id,
      metricId: metric.id,
      entries: [{ memberId: member.id, value: 100 }],
    });

    const entry = await prisma.memberMetricEntry.findFirst({
      where: { periodId: period.id, metricId: metric.id },
    });
    expect(entry?.observationGrain).toBe("PERIOD_VALUE");
    expect(entry?.status).toBe("ACTIVE");
  });
});
