import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metricPeriod: {
      findFirst: vi.fn(),
    },
    allianceMember: {
      count: vi.fn(),
    },
    memberMetricEntry: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/app/src/lib/prisma";
import { getPeriodResultsSummary } from "./getPeriodResultsSummary";

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

  it("calculates distinct member counts and separates active vs archived participants", async () => {
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "p1",
      periodMetrics: [
        { metric: { id: "m1", name: "Kill Points" } },
        { metric: { id: "m2", name: "VS Score" } },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);

    vi.mocked(prisma.allianceMember.count).mockResolvedValue(100);

    vi.mocked(prisma.memberMetricEntry.findMany).mockResolvedValue([
      // Member 1 (active): 2 entries for m1, 1 for m2
      { allianceMemberId: "mem1", metricId: "m1", allianceMember: { archivedAt: null } },
      { allianceMemberId: "mem1", metricId: "m1", allianceMember: { archivedAt: null } },
      { allianceMemberId: "mem1", metricId: "m2", allianceMember: { archivedAt: null } },
      // Member 2 (archived): 1 entry for m1
      { allianceMemberId: "mem2", metricId: "m1", allianceMember: { archivedAt: new Date() } },
    ] as unknown as Awaited<ReturnType<typeof prisma.memberMetricEntry.findMany>>);

    const summary = await getPeriodResultsSummary({ allianceId: "a1", periodId: "p1" });

    expect(summary.currentActiveMemberCount).toBe(100);
    expect(summary.participatingMemberCount).toBe(2); // mem1, mem2
    expect(summary.participatingActiveMemberCount).toBe(1); // mem1

    expect(summary.metrics).toEqual([
      { metricId: "m1", metricName: "Kill Points", memberCount: 2, activeMemberCount: 1 },
      { metricId: "m2", metricName: "VS Score", memberCount: 1, activeMemberCount: 1 },
    ]);
  });
});
