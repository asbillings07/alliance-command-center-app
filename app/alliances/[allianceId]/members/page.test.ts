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
    },
    memberMetricEntry: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "@/app/src/lib/prisma";
import MembersPage from "./page";

describe("MembersPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

    vi.mocked(prisma.memberMetricEntry.findMany).mockResolvedValue([
      {
        id: "entry_newer",
        allianceMemberId: "mem_1",
        metricId: "met_kill",
        value: 1250000,
        recordedAt: new Date("2026-07-24T10:00:00Z"),
        createdAt: new Date("2026-07-24T10:00:00Z"),
      },
      {
        id: "entry_older",
        allianceMemberId: "mem_1",
        metricId: "met_kill",
        value: 900000,
        recordedAt: new Date("2026-07-23T10:00:00Z"),
        createdAt: new Date("2026-07-23T10:00:00Z"),
      },
      {
        id: "entry_vs",
        allianceMemberId: "mem_2",
        metricId: "met_vs",
        value: 2300,
        recordedAt: new Date("2026-07-24T10:00:00Z"),
        createdAt: new Date("2026-07-24T10:00:00Z"),
      },
    ] as unknown as Awaited<ReturnType<typeof prisma.memberMetricEntry.findMany>>);

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

    expect(prisma.memberMetricEntry.findMany).toHaveBeenCalledWith({
      where: {
        periodId: "per_1",
        metricId: { in: ["met_kill", "met_vs"] },
        allianceMemberId: { in: ["mem_1", "mem_2"] },
        allianceMember: { allianceId: "all_1" },
      },
      select: {
        allianceMemberId: true,
        metricId: true,
        value: true,
        recordedAt: true,
        createdAt: true,
        id: true,
      },
      orderBy: [
        { recordedAt: "desc" },
        { createdAt: "desc" },
        { id: "desc" },
      ],
    });
  });
});
