import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createMetricPeriod,
  editMetricPeriod,
} from "./action";

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn().mockResolvedValue({}),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/touchAllianceSetupActivity", () => ({
  touchAllianceSetupActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metricPeriod: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { revalidatePath } from "next/cache";
import { prisma } from "@/app/src/lib/prisma";

const mockCreate = prisma.metricPeriod.create as ReturnType<typeof vi.fn>;
const mockFindFirst = prisma.metricPeriod.findFirst as ReturnType<typeof vi.fn>;
const mockUpdate = prisma.metricPeriod.update as ReturnType<typeof vi.fn>;
const mockTransaction = prisma.$transaction as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(async (fn: (tx: typeof prisma) => unknown) =>
    fn(prisma),
  );
});

function buildCreateFormData(fields: Record<string, string>): FormData {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    formData.set(key, value);
  }
  return formData;
}

describe("createMetricPeriod", () => {
  const allianceId = "alliance-1";

  it("returns periodId and revalidates setup-related paths on success", async () => {
    mockCreate.mockResolvedValue({ id: "period-new" });

    const result = await createMetricPeriod(
      buildCreateFormData({
        allianceId,
        name: "Season 7",
        startsAt: "2026-01-01",
        endsAt: "2026-03-31",
      }),
    );

    expect(result).toEqual({ success: true, periodId: "period-new" });
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/periods`);
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/setup`);
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/setup/import`);
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}`);
    expect(revalidatePath).toHaveBeenCalledWith(`/alliances/${allianceId}/reports`);
    expect(revalidatePath).toHaveBeenCalledWith(
      "/alliances/[allianceId]/reports/metrics/[metricId]",
      "page",
    );
  });

  it("rejects reversed dates with zero writes", async () => {
    const result = await createMetricPeriod(
      buildCreateFormData({
        allianceId,
        name: "Season 7",
        startsAt: "2026-03-31",
        endsAt: "2026-01-01",
      }),
    );

    expect(result).toEqual({
      success: false,
      error: "Start date must be on or before end date",
    });
    expect(mockCreate).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("editMetricPeriod", () => {
  const allianceId = "alliance-1";

  it("returns success without periodId", async () => {
    mockFindFirst.mockResolvedValue({ id: "period-1" });
    mockUpdate.mockResolvedValue({});

    const result = await editMetricPeriod(
      buildCreateFormData({
        allianceId,
        periodId: "period-1",
        name: "Updated Season",
        startsAt: "2026-01-01",
        endsAt: "2026-03-31",
      }),
    );

    expect(result).toEqual({ success: true });
    expect(mockUpdate).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid dates with zero writes", async () => {
    const result = await editMetricPeriod(
      buildCreateFormData({
        allianceId,
        periodId: "period-1",
        name: "Updated Season",
        startsAt: "not-a-date",
        endsAt: "2026-03-31",
      }),
    );

    expect(result).toEqual({ success: false, error: "Invalid start date" });
    expect(mockFindFirst).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
