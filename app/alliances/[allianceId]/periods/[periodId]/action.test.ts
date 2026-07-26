import { describe, it, expect, vi, beforeEach } from "vitest";
import { addMetricToPeriod, editPeriodMetric } from "./action";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn().mockResolvedValue({}),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/cache/revalidateAllianceData", () => ({
  revalidateAllianceData: vi.fn(),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metricPeriod: {
      findFirst: vi.fn(),
    },
    metric: {
      findFirst: vi.fn(),
    },
    metricPeriodMetric: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import { prisma } from "@/app/src/lib/prisma";

const mockPeriodFindFirst = prisma.metricPeriod.findFirst as ReturnType<
  typeof vi.fn
>;
const mockMetricFindFirst = prisma.metric.findFirst as ReturnType<typeof vi.fn>;
const mockCreate = prisma.metricPeriodMetric.create as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.metricPeriodMetric.update as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("addMetricToPeriod", () => {
  const allianceId = "alliance-a";
  const periodId = "period-a";
  const metricId = "metric-a";

  it("rejects a foreign metric ID with zero writes", async () => {
    mockPeriodFindFirst.mockResolvedValue({ id: periodId });
    mockMetricFindFirst.mockResolvedValue(null);

    const result = await addMetricToPeriod(
      buildFormData({
        allianceId,
        periodId,
        metricId,
        weight: "10",
      }),
    );

    expect(result).toEqual({ error: "Metric not found" });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(revalidateAllianceData).not.toHaveBeenCalled();
  });

  it("creates the attachment and invalidates setup progress surfaces", async () => {
    mockPeriodFindFirst.mockResolvedValue({ id: periodId });
    mockMetricFindFirst.mockResolvedValue({ id: metricId });
    mockCreate.mockResolvedValue({});

    const result = await addMetricToPeriod(
      buildFormData({
        allianceId,
        periodId,
        metricId,
        weight: "10",
      }),
    );

    expect(result).toEqual({ success: true });
    expect(mockMetricFindFirst).toHaveBeenCalledWith({
      where: { id: metricId, allianceId, active: true },
    });
    expect(revalidateAllianceData).toHaveBeenCalledWith({
      allianceId,
      periodId,
      domains: ["evaluation-results", "setup", "dashboard"],
    });
  });
});

describe("editPeriodMetric", () => {
  const allianceId = "alliance-a";
  const periodId = "period-a";
  const metricId = "metric-a";

  it("rejects a foreign metric ID with zero writes", async () => {
    mockPeriodFindFirst.mockResolvedValue({ id: periodId });
    mockMetricFindFirst.mockResolvedValue(null);

    const result = await editPeriodMetric(
      buildFormData({
        allianceId,
        periodId,
        metricId,
        weight: "10",
      }),
    );

    expect(result).toEqual({ error: "Metric not found" });
    expect(mockUpdate).not.toHaveBeenCalled();
    expect(revalidateAllianceData).not.toHaveBeenCalled();
  });
});
