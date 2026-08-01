import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as MetricsAction from "./action";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("metrics action [integration]", () => {
  let prisma: PrismaClient;
  let createMetric: typeof MetricsAction.createMetric;
  let editMetric: typeof MetricsAction.editMetric;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ createMetric, editMetric } = await import("./action"));
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      user: { id: "integration-test-user", email: "test@local" },
      permissions: { canConfigureMetrics: true } as unknown as Awaited<
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
      await prisma.allianceMember.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeAlliance() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Metrics Action Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  function buildFormData(fields: Record<string, string>): FormData {
    const formData = new FormData();
    for (const [key, value] of Object.entries(fields)) {
      formData.set(key, value);
    }
    return formData;
  }

  it("createMetric persists summaryKind and unitLabel", async () => {
    const alliance = await makeAlliance();

    const result = await createMetric(
      buildFormData({
        allianceId: alliance.id,
        name: "VS Score",
        type: "NUMERIC",
        summaryKind: "SUM",
        unitLabel: "pts",
      }),
    );

    expect(result).toEqual({ success: true });

    const metric = await prisma.metric.findFirst({ where: { allianceId: alliance.id } });
    expect(metric?.type).toBe("NUMERIC");
    expect(metric?.summaryKind).toBe("SUM");
    expect(metric?.unitLabel).toBe("pts");
  });

  it("editMetric ignores a submitted type change even when the metric already has entries", async () => {
    const alliance = await makeAlliance();
    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "VS Score", type: "NUMERIC", summaryKind: "SUM" },
    });
    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Period A" },
    });
    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "Player One" },
    });
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: false },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: period.id,
        metricId: metric.id,
        value: 100,
      },
    });

    const result = await editMetric(
      buildFormData({
        allianceId: alliance.id,
        metricId: metric.id,
        name: "VS Score",
        type: "BOOLEAN", // attempted change — must be ignored
        summaryKind: "SUM", // only valid if the real type (NUMERIC) is kept
      }),
    );

    expect(result).toEqual({ success: true });

    const updated = await prisma.metric.findUniqueOrThrow({ where: { id: metric.id } });
    expect(updated.type).toBe("NUMERIC");
    expect(updated.summaryKind).toBe("SUM");

    // The historical entry is still interpretable under the original type.
    const entry = await prisma.memberMetricEntry.findFirstOrThrow({
      where: { metricId: metric.id },
    });
    expect(entry.value).toBe(100);
  });
});
