import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTargetPeriod } from "./resolveTargetPeriod";
import { metricPeriodChronologicalOrderBy } from "../metricPeriodOrdering";

vi.mock("../prisma", () => ({
  prisma: {
    metricPeriod: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "../prisma";

const mockFindFirst = prisma.metricPeriod.findFirst as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveTargetPeriod", () => {
  it("returns the latest active period ordered by startsAt", async () => {
    mockFindFirst.mockResolvedValue({
      id: "period-active",
      name: "Season 7",
      periodMetrics: [{ metricId: "m-1" }],
    });

    const result = await resolveTargetPeriod("alliance-1");

    expect(result).toEqual({
      id: "period-active",
      name: "Season 7",
      periodMetrics: [{ metricId: "m-1" }],
    });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { allianceId: "alliance-1", active: true },
      orderBy: metricPeriodChronologicalOrderBy,
      select: {
        id: true,
        name: true,
        periodMetrics: {
          where: { active: true, metric: { active: true } },
          select: { metricId: true },
        },
      },
    });
  });

  it("returns null when only archived periods exist (no fallback)", async () => {
    mockFindFirst.mockResolvedValue(null);

    const result = await resolveTargetPeriod("alliance-1");

    expect(result).toBeNull();
    expect(mockFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { allianceId: "alliance-1", active: true },
      }),
    );
  });
});
