import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
  // MembersTable (a Client Component rendered inline by this Server
  // Component) calls useRouter() for router.refresh() after a bulk action.
  // renderToStaticMarkup executes the whole tree, so it needs a stub.
  useRouter: () => ({ refresh: vi.fn() }),
}));

vi.mock("@/app/src/lib/auth", () => ({}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn().mockResolvedValue({
    permissions: {
      canImportMembers: false,
      canManageMembers: false,
    },
  }),
}));

vi.mock("@/app/src/lib/allianceSetup", () => ({
  getAllianceSetupStatus: vi.fn(),
}));

vi.mock("./MembersPeriodSelector", () => ({
  MembersPeriodSelector: () => null,
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    alliance: {
      findUnique: vi.fn(),
    },
    allianceMember: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    metricPeriod: {
      findFirst: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

vi.mock("@/app/src/lib/metrics/memberPeriodMetricValues", () => ({
  memberPeriodMetricValues: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "@/app/src/lib/prisma";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import MembersPage from "./page";

/** Builds one `memberPeriodMetricValues` row from a legacy-test-style {allianceMemberId, metricId, value} triple. */
function rollupRow(allianceMemberId: string, metricId: string, value: number) {
  return {
    metricId,
    allianceMemberId,
    value,
    observationCount: 1,
    lastObservedOn: null,
    provenance: "Source period value" as const,
  };
}

function mockSetupStatus(overrides: Partial<Awaited<ReturnType<typeof getAllianceSetupStatus>>> = {}) {
  vi.mocked(getAllianceSetupStatus).mockResolvedValue({
    tasks: [],
    isComplete: false,
    completedCount: 0,
    totalCount: 0,
    requiredComplete: 0,
    requiredTotal: 0,
    targetPeriodId: null,
    hasArchivedPeriodsOnly: false,
    activeMemberCount: 2,
    recommendedTask: null,
    ...overrides,
  });
}

describe("MembersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetupStatus();
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([]);
    vi.mocked(memberPeriodMetricValues).mockResolvedValue([]);
  });

  it("renders actionable empty state CTAs for Admins/Owners when no active members exist", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMembers: true,
        canManageMembers: true,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);

    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([]);
    vi.mocked(prisma.allianceMember.count).mockResolvedValue(0);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({}),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain("No active members yet");
    expect(html).toContain("Import members from a spreadsheet or add them manually to get started.");
    expect(html).toContain("/alliances/all_1/members/new");
    expect(html).toContain("/alliances/all_1/members/import");
  });

  it("renders a subdued Import history link next to Import Members when the roster is non-empty", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMembers: true,
        canManageMembers: true,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);

    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      { id: "mem_1", playerName: "Dragon", archivedAt: null },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('href="/alliances/all_1/members/imports"');
    expect(html).toContain("Import history");
  });

  it("does not render an Import history link for roles without canImportMembers", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMembers: false,
        canManageMembers: false,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);

    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      { id: "mem_1", playerName: "Dragon", archivedAt: null },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain('href="/alliances/all_1/members/imports"');
  });

  it("renders informative empty state with Back to Dashboard for non-admins when no active members exist", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMembers: false,
        canManageMembers: false,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);

    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([]);
    vi.mocked(prisma.allianceMember.count).mockResolvedValue(0);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({}),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain("No active members yet");
    expect(html).toContain("An alliance Admin or Owner must import or add members first.");
    expect(html).toContain("/alliances/all_1");
    expect(html).toContain("Back to Dashboard");
  });

  it("shows selected period metric values in the members table and links rows to period-aware member profiles", async () => {
    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);

    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      {
        id: "mem_1",
        allianceId: "all_1",
        playerName: "Dragon",
        discordName: null,
        thp: 450000000,
        squadPower: null,
        role: "R4",
        joinedAt: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: null,
      },
      {
        id: "mem_2",
        allianceId: "all_1",
        playerName: "Phoenix",
        discordName: null,
        thp: null,
        squadPower: null,
        role: null,
        joinedAt: null,
        archivedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        userId: null,
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);

    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_1",
      name: "Week 28 Evaluation",
      periodMetrics: [
        { metricId: "met_kill", metric: { id: "met_kill", name: "Kill Points" } },
        { metricId: "met_vs", metric: { id: "met_vs", name: "VS Score" } },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);

    // The "keep the newest of two corrections" case is now resolved inside
    // memberPeriodMetricValues (real coverage lives in that module's own
    // rollup-algebra integration tests) - the mock here returns the already-
    // resolved value directly, matching what the real function would return
    // for mem_1's two corrections.
    vi.mocked(memberPeriodMetricValues).mockResolvedValue([
      rollupRow("mem_1", "met_kill", 1250000),
      rollupRow("mem_2", "met_vs", 2300),
    ]);

    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(2)
      .mockResolvedValueOnce(0);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({ periodId: "per_1" }),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain("Week 28 Evaluation results");
    expect(html).toContain("Kill Points");
    expect(html).toContain("VS Score");
    expect(html).toContain("1.3M");
    expect(html).toContain("2.3K");
    expect(html).toContain('/alliances/all_1/members/mem_1?periodId=per_1');
    expect(html).toContain('aria-label="Dragon Kill Points"');
  });

  it("shows invalid period notice instead of silently falling back to roster-only", async () => {
    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      {
        id: "mem_1",
        playerName: "Dragon",
        archivedAt: null,
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
      { id: "per_1", name: "Season 7", active: true },
    ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({ periodId: "missing-period" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("This evaluation period is not available");
    expect(html).toContain("Return to roster");
    expect(html).not.toContain("Create an evaluation period before viewing member results");
  });

  it("prefers no-periods banner over invalid-period when both conditions apply", async () => {
    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      { id: "mem_1", playerName: "Dragon", archivedAt: null },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([]);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({ periodId: "missing-period" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Create an evaluation period before viewing member results");
    expect(html).not.toContain("This evaluation period is not available");
  });

  it("still renders archived metric columns and values when the metric is inactive", async () => {
    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      {
        id: "mem_1",
        playerName: "Dragon",
        archivedAt: null,
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_archived",
      name: "Season 6",
      periodMetrics: [
        {
          metricId: "met_archived",
          metric: { id: "met_archived", name: "Legacy Kill Points" },
        },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);
    vi.mocked(memberPeriodMetricValues).mockResolvedValue([rollupRow("mem_1", "met_archived", 850000)]);
    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
      { id: "per_archived", name: "Season 6", active: false },
    ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({ periodId: "per_archived" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Legacy Kill Points");
    expect(html).toContain("850K");
    expect(prisma.metricPeriod.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "per_archived", allianceId: "all_1" },
        select: expect.objectContaining({
          periodMetrics: expect.objectContaining({
            where: { active: true },
          }),
        }),
      }),
    );
  });

  it("links no-metrics remediation to the period detail attach flow", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canConfigurePeriods: true,
        canImportMembers: false,
        canManageMembers: false,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      { id: "mem_1", playerName: "Dragon", archivedAt: null },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_empty",
      name: "Week 29",
      periodMetrics: [],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);
    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
      { id: "per_empty", name: "Week 29", active: true },
    ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({ periodId: "per_empty" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('href="/alliances/all_1/periods/per_empty"');
    expect(html).not.toContain("/metrics?returnTo=");
  });

  it("preserves archived members in All view even when there are zero active members", async () => {
    mockSetupStatus({ activeMemberCount: 0 });
    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      {
        id: "mem_arch",
        playerName: "OldHero",
        archivedAt: new Date(),
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
      { id: "per_1", name: "Season 6", active: false },
    ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({ filter: "all" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain("No active members yet");
    expect(html).toContain("OldHero");
  });

  it("shows no-results banner with record/import actions when active members exist", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMembers: true,
        canManageMembers: true,
        canImportMetrics: true,
        canConfigurePeriods: true,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockSetupStatus({ activeMemberCount: 2 });

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      { id: "mem_1", playerName: "Dragon", archivedAt: null },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_1",
      name: "Week 28 Evaluation",
      periodMetrics: [
        { metricId: "met_kill", metric: { id: "met_kill", name: "Kill Points" } },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
      { id: "per_1", name: "Week 28 Evaluation", active: true },
    ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);
    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(1)
      .mockResolvedValueOnce(0);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({ periodId: "per_1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No results for members in this view");
    expect(html).toContain("Record Results");
    expect(html).toContain("/alliances/all_1/periods/per_1/import");
  });

  it("shows read-only no-results copy when viewing archived members with zero active members", async () => {
    mockSetupStatus({ activeMemberCount: 0 });
    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      { id: "mem_arch", playerName: "OldHero", archivedAt: new Date() },
    ] as unknown as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_1",
      name: "Week 28 Evaluation",
      periodMetrics: [
        { metricId: "met_kill", metric: { id: "met_kill", name: "Kill Points" } },
      ],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);
    vi.mocked(prisma.allianceMember.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(1);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([
      { id: "per_1", name: "Week 28 Evaluation", active: true },
    ] as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findMany>>);

    const page = await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({ filter: "archived", periodId: "per_1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No results for members in this view");
    expect(html).toContain("Record and import workflows operate on active members only");
    expect(html).not.toContain("/alliances/all_1/periods/per_1/record");
  });

  it("uses deterministic ordering when querying all periods for the selector", async () => {
    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([]);
    vi.mocked(prisma.allianceMember.count).mockResolvedValue(0);

    await MembersPage({
      params: Promise.resolve({ allianceId: "all_1" }),
      searchParams: Promise.resolve({}),
    });

    expect(prisma.metricPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { allianceId: "all_1" },
        orderBy: expect.any(Array),
      }),
    );
  });
});
