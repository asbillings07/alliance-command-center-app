import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { Metric_Type } from "@/app/generated/prisma/client";
import type * as PeriodMetricAction from "./action";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";

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

describe.skipIf(!runDb)("period metric actions [integration]", () => {
  let prisma: PrismaClient;
  let addMetricToPeriod: typeof PeriodMetricAction.addMetricToPeriod;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ addMetricToPeriod } = await import("./action"));
  });

  beforeEach(() => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      user: { id: "integration-test-user", email: "test@local" },
      permissions: {
        canConfigurePeriods: true,
      } as unknown as Awaited<
        ReturnType<typeof requireAllianceAccess>
      >["permissions"],
      membership: { role: "ADMIN" } as unknown as Awaited<
        ReturnType<typeof requireAllianceAccess>
      >["membership"],
    });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.metricPeriodMetric.deleteMany({
        where: { period: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriod.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.metric.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.alliance.deleteMany({
        where: { id: { in: createdAllianceIds } },
      });
      createdAllianceIds.length = 0;
    }
  });

  it("rejects attaching a metric from another alliance with zero writes", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const allianceA = await prisma.alliance.create({
      data: { name: `Alliance A ${suffix}`, server: "1001" },
    });
    const allianceB = await prisma.alliance.create({
      data: { name: `Alliance B ${suffix}`, server: "1002" },
    });
    createdAllianceIds.push(allianceA.id, allianceB.id);

    const periodA = await prisma.metricPeriod.create({
      data: {
        allianceId: allianceA.id,
        name: `Period A ${suffix}`,
        active: true,
      },
    });

    const foreignMetric = await prisma.metric.create({
      data: {
        allianceId: allianceB.id,
        name: `Foreign Metric ${suffix}`,
        type: Metric_Type.NUMERIC,
      },
    });

    const formData = new FormData();
    formData.set("allianceId", allianceA.id);
    formData.set("periodId", periodA.id);
    formData.set("metricId", foreignMetric.id);
    formData.set("weight", "10");

    const result = await addMetricToPeriod(formData);

    expect(result).toEqual({ error: "Metric not found" });

    const attachmentCount = await prisma.metricPeriodMetric.count({
      where: { periodId: periodA.id, metricId: foreignMetric.id },
    });
    expect(attachmentCount).toBe(0);
  });
});
