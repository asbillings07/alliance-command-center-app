import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metricPeriod: {
      findFirst: vi.fn(),
    },
    allianceMember: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/app/src/lib/metrics/memberPeriodMetricValues", () => ({
  memberPeriodMetricValues: vi.fn(),
}));

import { prisma } from "@/app/src/lib/prisma";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";
import { getPeriodResultsSummary } from "./getPeriodResultsSummary";

/** A `MemberPeriodMetricValue`-shaped row with only the fields this consumer reads. */
function row(allianceMemberId: string, metricId: string, observationCount: number) {
  return {
    allianceMemberId,
    metricId,
    value: observationCount > 0 ? 1 : null,
    observationCount,
    lastObservedOn: null,
    provenance: "Source period value" as const,
  };
}

describe("getPeriodResultsSummary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws error if allianceId or periodId is missing", async () => {
    await expect(
      getPeriodResultsSummary({ allianceId: "", periodId: "p1" })
    ).rejects.toThrow("allianceId and periodId are required");
  });

  it("throws error if period is not found", async () => {
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(null);

    await expect(
      getPeriodResultsSummary({ allianceId: "a1", periodId: "p1" })
    ).rejects.toThrow("Period not found");
  });

  it("returns zero counts and skips the read model when period has no active metrics", async () => {
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "p1",
      periodMetrics: [],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);

    vi.mocked(prisma.allianceMember.count).mockResolvedValue(50);

    const summary = await getPeriodResultsSummary({ allianceId: "a1", periodId: "p1" });

    expect(summary.currentActiveMemberCount).toBe(50);
    expect(summary.participatingMemberCount).toBe(0);
    expect(summary.participatingActiveMemberCount).toBe(0);
    expect(summary.metrics).toEqual([]);
    expect(memberPeriodMetricValues).not.toHaveBeenCalled();
  });

  it("filters query by active metric IDs and derives participation from observationCount > 0", async () => {
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "p1",
      periodMetrics: [
        { metric: { id: "m1", name: "Kill Points" } },
        { metric: { id: "m2", name: "VS Score" } },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);

    vi.mocked(prisma.allianceMember.count).mockResolvedValue(100);

    vi.mocked(memberPeriodMetricValues).mockResolvedValue([
      row("mem1", "m1", 1),
      row("mem1", "m2", 1),
      row("mem2", "m1", 1),
      // A voided-only member: `memberPeriodMetricValues` already resolved
      // this to observationCount 0 - this consumer must not re-derive
      // participation from row presence alone.
      row("mem3", "m1", 0),
    ]);

    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      { id: "mem1" },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);

    const summary = await getPeriodResultsSummary({ allianceId: "a1", periodId: "p1" });

    expect(memberPeriodMetricValues).toHaveBeenCalledWith("a1", "p1", ["m1", "m2"]);

    expect(prisma.allianceMember.findMany).toHaveBeenCalledWith({
      where: {
        id: { in: ["mem1", "mem2"] },
        allianceId: "a1",
        archivedAt: null,
      },
      select: { id: true },
    });

    expect(summary.currentActiveMemberCount).toBe(100);
    expect(summary.participatingMemberCount).toBe(2); // mem1, mem2 - mem3 excluded (0 observations)
    expect(summary.participatingActiveMemberCount).toBe(1); // mem1

    expect(summary.metrics).toEqual([
      { metricId: "m1", metricName: "Kill Points", memberCount: 2, activeMemberCount: 1 },
      { metricId: "m2", metricName: "VS Score", memberCount: 1, activeMemberCount: 1 },
    ]);
  });
});
