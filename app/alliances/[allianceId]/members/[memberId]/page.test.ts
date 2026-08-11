import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/app/src/lib/auth", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn().mockResolvedValue({
    permissions: {
      canViewAlliance: true,
      canViewMembers: true,
      canManageMembers: false,
      canManageNotes: false,
      canInviteCollaborators: false,
    },
    user: { id: "user_1" },
  }),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    allianceMember: {
      findFirst: vi.fn(),
    },
    metricPeriod: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    memberMetricEntry: {
      findMany: vi.fn(),
    },
    leadershipNote: {
      findMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    allianceMembership: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/app/src/lib/metrics/memberPeriodMetricValues", () => ({
  memberPeriodMetricValues: vi.fn(),
}));

import { prisma } from "@/app/src/lib/prisma";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";
import MemberPage from "./page";

type ChildElement = {
  type?: { name?: string };
  props?: {
    periodStatusLabel?: string;
    metrics?: { metricId: string; current?: unknown; periodTrend?: unknown }[];
  };
};

describe("MemberPage (Server Page)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("labels explicitly selected older inactive period as 'Inactive Period' and preserves periodId in breadcrumb", async () => {
    vi.mocked(prisma.allianceMember.findFirst).mockResolvedValue({
      id: "mem_1",
      allianceId: "all_1",
      playerName: "Valkyrie",
      userId: null,
      role: null,
      thp: null,
      squadPower: null,
      joinedAt: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findFirst>>);

    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
      { id: "per_latest", name: "Week 20", active: true, startsAt: new Date("2026-04-13"), createdAt: new Date("2026-04-06") },
      { id: "per_older", name: "Week 19", active: false, startsAt: new Date("2026-04-06"), createdAt: new Date("2026-03-30") },
    ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);

    vi.mocked(prisma.metricPeriod.findUnique).mockResolvedValue({
      id: "per_older",
      name: "Week 19",
      active: false,
      allianceId: "all_1",
      startsAt: null,
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      periodMetrics: [],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findUnique>>);

    vi.mocked(prisma.leadershipNote.findMany).mockResolvedValue([]);

    const result = await MemberPage({
      params: Promise.resolve({ allianceId: "all_1", memberId: "mem_1" }),
      searchParams: Promise.resolve({ periodId: "per_older" }),
    });

    const props = result.props;

    // Verify breadcrumbs preserve periodId
    expect(props.breadcrumb).toEqual([
      { label: "Dashboard", href: "/alliances/all_1" },
      { label: "Members", href: "/alliances/all_1/members?periodId=per_older" },
      { label: "Valkyrie" },
    ]);

    // Find MemberPerformanceSection child
    const children = props.children.props.children as ChildElement[];
    const performanceSection = children.find(
      (c) => c && c.type && c.type.name === "MemberPerformanceSection"
    );

    expect(performanceSection).toBeDefined();
    // Explicitly selected inactive period MUST be labeled "Inactive Period"
    expect(performanceSection?.props?.periodStatusLabel).toBe("Inactive Period");
  });

  it("labels auto-fallback latest inactive period as 'Latest Period · Not active'", async () => {
    vi.mocked(prisma.allianceMember.findFirst).mockResolvedValue({
      id: "mem_1",
      allianceId: "all_1",
      playerName: "Valkyrie",
      userId: null,
      role: null,
      thp: null,
      squadPower: null,
      joinedAt: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findFirst>>);

    // All periods inactive
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
      { id: "per_latest_inactive", name: "Week 18", active: false, startsAt: new Date("2026-03-23"), createdAt: new Date("2026-03-16") },
    ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);

    vi.mocked(prisma.metricPeriod.findUnique).mockResolvedValue({
      id: "per_latest_inactive",
      name: "Week 18",
      active: false,
      allianceId: "all_1",
      startsAt: null,
      endsAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      periodMetrics: [],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findUnique>>);

    vi.mocked(prisma.leadershipNote.findMany).mockResolvedValue([]);

    const result = await MemberPage({
      params: Promise.resolve({ allianceId: "all_1", memberId: "mem_1" }),
      searchParams: Promise.resolve({}),
    });

    const props = result.props;
    const children = props.children.props.children as ChildElement[];
    const performanceSection = children.find(
      (c) => c && c.type && c.type.name === "MemberPerformanceSection"
    );

    expect(performanceSection).toBeDefined();
    expect(performanceSection?.props?.periodStatusLabel).toBe("Latest Period · Not active");
  });

  it("auto-selects the chronologically current active period instead of the newest createdAt", async () => {
    vi.mocked(prisma.allianceMember.findFirst).mockResolvedValue({
      id: "mem_1",
      allianceId: "all_1",
      playerName: "Valkyrie",
      userId: null,
      role: null,
      thp: null,
      squadPower: null,
      joinedAt: null,
      archivedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findFirst>>);

    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
      {
        id: "per_current",
        name: "April 2026 Current",
        active: true,
        startsAt: new Date("2026-04-06T00:00:00.000Z"),
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      {
        id: "per_imported",
        name: "March 2026 Imported",
        active: true,
        startsAt: new Date("2026-03-01T00:00:00.000Z"),
        createdAt: new Date("2026-07-01T00:00:00.000Z"),
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);

    vi.mocked(prisma.metricPeriod.findUnique).mockResolvedValue({
      id: "per_current",
      name: "April 2026 Current",
      active: true,
      allianceId: "all_1",
      startsAt: new Date("2026-04-06T00:00:00.000Z"),
      endsAt: new Date("2026-04-13T00:00:00.000Z"),
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date(),
      periodMetrics: [],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findUnique>>);

    vi.mocked(prisma.leadershipNote.findMany).mockResolvedValue([]);

    await MemberPage({
      params: Promise.resolve({ allianceId: "all_1", memberId: "mem_1" }),
      searchParams: Promise.resolve({}),
    });

    expect(prisma.metricPeriod.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "per_current" },
      }),
    );
  });

  // #321/#322: the period-over-period trend, wired end to end (period
  // resolution -> two memberPeriodMetricValues calls -> merge into the
  // correction-history view model), not just the pure functions it's built
  // from - covering the gating rule (#3 in #321's scope comment) that a
  // unit test on either pure function alone can't exercise.
  describe("period-over-period trend wiring (#321/#322)", () => {
    function mockAllianceMember(overrides: Partial<Record<string, unknown>> = {}) {
      vi.mocked(prisma.allianceMember.findFirst).mockResolvedValue({
        id: "mem_1",
        allianceId: "all_1",
        playerName: "Valkyrie",
        userId: null,
        role: null,
        thp: null,
        squadPower: null,
        joinedAt: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...overrides,
      } as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findFirst>>);
    }

    function mockSelectedPeriod(id: string, name: string) {
      vi.mocked(prisma.metricPeriod.findUnique).mockResolvedValue({
        id,
        name,
        active: true,
        allianceId: "all_1",
        startsAt: new Date("2026-04-06"),
        endsAt: new Date("2026-04-13"),
        createdAt: new Date("2026-04-06"),
        updatedAt: new Date(),
        periodMetrics: [{ metricId: "met_kill", metric: { id: "met_kill", name: "Kill Points" } }],
      } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findUnique>>);
    }

    function performanceMetrics(props: { children: { props: { children: ChildElement[] } } }) {
      const performanceSection = props.children.props.children.find(
        (c) => c && c.type && c.type.name === "MemberPerformanceSection",
      );
      return performanceSection?.props?.metrics ?? [];
    }

    it("attaches a comparable trend when both the selected and adjacent prior period have active baselines", async () => {
      mockAllianceMember();
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
        { id: "per_current", name: "Week 20", active: true, startsAt: new Date("2026-04-13"), createdAt: new Date("2026-04-06") },
        { id: "per_prior", name: "Week 19", active: false, startsAt: new Date("2026-04-06"), createdAt: new Date("2026-03-30") },
      ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);
      mockSelectedPeriod("per_current", "Week 20");
      vi.mocked(prisma.memberMetricEntry.findMany).mockResolvedValue([
        { metricId: "met_kill", value: 900, recordedAt: new Date("2026-04-10"), createdAt: new Date("2026-04-10"), id: "e1" },
      ] as unknown as Awaited<ReturnType<typeof prisma.memberMetricEntry.findMany>>);
      vi.mocked(prisma.leadershipNote.findMany).mockResolvedValue([]);

      vi.mocked(memberPeriodMetricValues).mockImplementation(async (_allianceId, periodId) =>
        periodId === "per_current"
          ? [{ metricId: "met_kill", allianceMemberId: "mem_1", value: 900, observationCount: 1, lastObservedOn: null, provenance: "Source period value" }]
          : [{ metricId: "met_kill", allianceMemberId: "mem_1", value: 850, observationCount: 1, lastObservedOn: null, provenance: "Source period value" }],
      );

      const result = await MemberPage({
        params: Promise.resolve({ allianceId: "all_1", memberId: "mem_1" }),
        searchParams: Promise.resolve({ periodId: "per_current" }),
      });

      const [metric] = performanceMetrics(result.props);
      expect(metric?.periodTrend).toEqual({
        status: "comparable",
        currentValue: 900,
        previousValue: 850,
        delta: 50,
        direction: "up",
      });

      // Both calls are single-member and scoped to the exact adjacent period ids.
      expect(memberPeriodMetricValues).toHaveBeenCalledWith("all_1", "per_current", ["met_kill"], { memberIds: ["mem_1"] });
      expect(memberPeriodMetricValues).toHaveBeenCalledWith("all_1", "per_prior", ["met_kill"], { memberIds: ["mem_1"] });
    });

    it("reports 'new' when the selected period is the alliance's first ever period, without ever calling memberPeriodMetricValues for a prior period", async () => {
      mockAllianceMember();
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
        { id: "per_only", name: "Week 1", active: true, startsAt: new Date("2026-01-05"), createdAt: new Date("2026-01-01") },
      ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);
      mockSelectedPeriod("per_only", "Week 1");
      vi.mocked(prisma.memberMetricEntry.findMany).mockResolvedValue([
        { metricId: "met_kill", value: 500, recordedAt: new Date("2026-01-06"), createdAt: new Date("2026-01-06"), id: "e1" },
      ] as unknown as Awaited<ReturnType<typeof prisma.memberMetricEntry.findMany>>);
      vi.mocked(prisma.leadershipNote.findMany).mockResolvedValue([]);
      vi.mocked(memberPeriodMetricValues).mockResolvedValue([
        { metricId: "met_kill", allianceMemberId: "mem_1", value: 500, observationCount: 1, lastObservedOn: null, provenance: "Source period value" },
      ]);

      const result = await MemberPage({
        params: Promise.resolve({ allianceId: "all_1", memberId: "mem_1" }),
        searchParams: Promise.resolve({ periodId: "per_only" }),
      });

      const [metric] = performanceMetrics(result.props);
      expect(metric?.periodTrend).toEqual({ status: "new" });
      // Only ever called once (for the selected period) - never for a
      // nonexistent prior period.
      expect(memberPeriodMetricValues).toHaveBeenCalledTimes(1);
    });

    it("shows no trend at all when the current-period value is void/never-recorded, even though a prior-period baseline exists", async () => {
      mockAllianceMember();
      vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
        { id: "per_current", name: "Week 20", active: true, startsAt: new Date("2026-04-13"), createdAt: new Date("2026-04-06") },
        { id: "per_prior", name: "Week 19", active: false, startsAt: new Date("2026-04-06"), createdAt: new Date("2026-03-30") },
      ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);
      mockSelectedPeriod("per_current", "Week 20");
      // The most recent event this period is a VOIDED row (null value) -
      // buildCurrentMetricViewModels resolves `current` to undefined for this.
      vi.mocked(prisma.memberMetricEntry.findMany).mockResolvedValue([
        { metricId: "met_kill", value: 750, recordedAt: new Date("2026-04-08"), createdAt: new Date("2026-04-08"), id: "e_active" },
        { metricId: "met_kill", value: null, recordedAt: new Date("2026-04-10"), createdAt: new Date("2026-04-10"), id: "e_voided" },
      ] as unknown as Awaited<ReturnType<typeof prisma.memberMetricEntry.findMany>>);
      vi.mocked(prisma.leadershipNote.findMany).mockResolvedValue([]);

      // Even though the rollup would happily report a comparable trend...
      vi.mocked(memberPeriodMetricValues).mockImplementation(async (_allianceId, periodId) =>
        periodId === "per_current"
          ? [] // the void means no ACTIVE slot this period either
          : [{ metricId: "met_kill", allianceMemberId: "mem_1", value: 850, observationCount: 1, lastObservedOn: null, provenance: "Source period value" }],
      );

      const result = await MemberPage({
        params: Promise.resolve({ allianceId: "all_1", memberId: "mem_1" }),
        searchParams: Promise.resolve({ periodId: "per_current" }),
      });

      const [metric] = performanceMetrics(result.props);
      expect(metric?.current).toBeUndefined();
      expect(metric?.periodTrend).toBeUndefined();
    });
  });
});
