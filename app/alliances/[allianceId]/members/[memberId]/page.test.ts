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

import { prisma } from "@/app/src/lib/prisma";
import MemberPage from "./page";

type ChildElement = {
  type?: { name?: string };
  props?: { periodStatusLabel?: string };
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
      { id: "per_latest", name: "Week 20", active: true },
      { id: "per_older", name: "Week 19", active: false },
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
      { id: "per_latest_inactive", name: "Week 18", active: false },
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
});
