import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn().mockResolvedValue({}),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/cache/revalidateAllianceData", () => ({
  revalidateAllianceData: vi.fn(),
}));

vi.mock("@/app/src/lib/touchAllianceSetupActivity", () => ({
  touchAllianceSetupActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metric: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    metricPeriodMetric: {
      findMany: vi.fn().mockResolvedValue([]),
    },
    $transaction: vi.fn(),
  },
}));

import { revalidatePath } from "next/cache";
import { prisma } from "@/app/src/lib/prisma";
import { createMetric, editMetric } from "./action";

const mockCreate = prisma.metric.create as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.metric.update as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.metric.findFirst as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;

const allianceId = "alliance-1";

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
});

function buildFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("createMetric", () => {
  it("creates a NUMERIC metric with a SUM summaryKind and unit label", async () => {
    mockCreate.mockResolvedValue({ id: "metric-1" });

    const result = await createMetric(
      buildFormData({
        allianceId,
        name: "VS Score",
        type: "NUMERIC",
        summaryKind: "SUM",
        unitLabel: "pts",
      }),
    );

    expect(result).toEqual({ success: true });
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: "NUMERIC",
          summaryKind: "SUM",
          unitLabel: "pts",
        }),
      }),
    );
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/metrics`);
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/reports`);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/reports/metrics/[metricId]",
      "page",
    );
  });

  it("defaults summaryKind to NONE and unitLabel to null when omitted", async () => {
    mockCreate.mockResolvedValue({ id: "metric-1" });

    await createMetric(
      buildFormData({ allianceId, name: "Some Metric", type: "NUMERIC" }),
    );

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ summaryKind: "NONE", unitLabel: null }),
      }),
    );
  });

  it("rejects SUM for a BOOLEAN metric with zero writes", async () => {
    const result = await createMetric(
      buildFormData({
        allianceId,
        name: "Attendance",
        type: "BOOLEAN",
        summaryKind: "SUM",
      }),
    );

    expect(result).toEqual({ error: "Total requires a Numeric metric" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects TRUE_RATE for a NUMERIC metric with zero writes", async () => {
    const result = await createMetric(
      buildFormData({
        allianceId,
        name: "VS Score",
        type: "NUMERIC",
        summaryKind: "TRUE_RATE",
      }),
    );

    expect(result).toEqual({ error: "True rate requires a Boolean metric" });
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("rejects a unit label over the max length with zero writes", async () => {
    const result = await createMetric(
      buildFormData({
        allianceId,
        name: "VS Score",
        type: "NUMERIC",
        unitLabel: "a".repeat(25),
      }),
    );

    expect(result).toEqual({
      error: "Unit label must be 24 characters or fewer",
    });
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("editMetric", () => {
  const metricId = "metric-1";

  it("ignores a submitted type change and keeps the metric's existing type", async () => {
    mockFindFirst.mockResolvedValue({ id: metricId, allianceId, active: true, type: "NUMERIC" });
    mockUpdate.mockResolvedValue({});

    const result = await editMetric(
      buildFormData({
        allianceId,
        metricId,
        name: "VS Score",
        type: "BOOLEAN", // attempted change — must be ignored
        summaryKind: "SUM", // only valid because the real (NUMERIC) type is kept
      }),
    );

    expect(result).toEqual({ success: true });
    const updateCall = mockUpdate.mock.calls[0][0];
    expect(updateCall.data).not.toHaveProperty("type");
    expect(updateCall.data.summaryKind).toBe("SUM");
  });

  it("validates summaryKind against the metric's existing type, not the submitted one", async () => {
    mockFindFirst.mockResolvedValue({ id: metricId, allianceId, active: true, type: "BOOLEAN" });

    const result = await editMetric(
      buildFormData({
        allianceId,
        metricId,
        name: "Attendance",
        type: "NUMERIC", // attempted change — ignored; real type is BOOLEAN
        summaryKind: "SUM", // invalid for BOOLEAN
      }),
    );

    expect(result).toEqual({ error: "Total requires a Numeric metric" });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("revalidates reports paths on success", async () => {
    mockFindFirst.mockResolvedValue({ id: metricId, allianceId, active: true, type: "NUMERIC" });
    mockUpdate.mockResolvedValue({});

    await editMetric(
      buildFormData({ allianceId, metricId, name: "VS Score", type: "NUMERIC" }),
    );

    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/metrics`);
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/reports`);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/reports/metrics/[metricId]",
      "page",
    );
  });
});
