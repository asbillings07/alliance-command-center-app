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
  requireAllianceAccess: vi.fn(),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    alliance: {
      findUnique: vi.fn(),
    },
    metricPeriod: {
      findFirst: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
    },
    metric: {
      count: vi.fn().mockResolvedValue(1),
    },
    allianceMembership: {
      count: vi.fn().mockResolvedValue(1),
    },
    invitation: {
      count: vi.fn().mockResolvedValue(0),
    },
    allianceMember: {
      count: vi.fn().mockResolvedValue(5),
    },
    memberMetricEntry: {
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import AlliancePage from "./page";
import { metricPeriodChronologicalOrderBy } from "@/app/src/lib/metricPeriodOrdering";

describe("AllianceDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders Record Now and Import Evaluation Results when active period has active metrics", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "ADMIN" },
      permissions: {
        canViewAlliance: true,
        canImportMetrics: true,
        canConfigureMetrics: true,
        canConfigurePeriods: true,
        canImportMembers: true,
        canManageMembers: true,
        canInviteCollaborators: true,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
      server: "Server 100",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);

    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_1",
      name: "Week 30 Evaluation",
      active: true,
      periodMetrics: [{ metricId: "met_vs" }],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);

    const page = await AlliancePage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain("Evaluation Results");
    expect(html).toContain("Week 30 Evaluation");
    expect(html).toContain("Record Now");
    expect(html).toContain("Import Evaluation Results");
    expect(html).toContain("/alliances/all_1/periods/per_1/record");
    expect(html).toContain("/alliances/all_1/periods/per_1/import");
  });

  it("renders contextual guidance when active period has 0 assigned active metrics", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "LEADER" },
      permissions: {
        canViewAlliance: true,
        canImportMetrics: true,
        canConfigureMetrics: true,
        canConfigurePeriods: true,
        canImportMembers: false,
        canManageMembers: false,
        canInviteCollaborators: false,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
      server: "Server 100",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);

    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_empty",
      name: "Week 31 Evaluation",
      active: true,
      periodMetrics: [], // 0 active period metrics
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);

    const page = await AlliancePage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain("Evaluation Results");
    expect(html).toContain("Active period <strong>Week 31 Evaluation</strong> has no assigned metrics yet.");
    expect(html).toContain("Manage Period Metrics");
    expect(html).toContain("Import Evaluation Results");
    expect(html).toContain("/alliances/all_1/periods/per_empty");
    expect(html).toContain("/alliances/all_1/periods/per_empty/import");
  });

  it("uses deterministic ordering when querying active period", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "ADMIN" },
      permissions: {
        canViewAlliance: true,
        canImportMetrics: true,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
      server: "Server 100",
    } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);

    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(null);

    await AlliancePage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });

    expect(prisma.metricPeriod.findFirst).toHaveBeenCalledWith({
      where: {
        allianceId: "all_1",
        active: true,
      },
      orderBy: metricPeriodChronologicalOrderBy,
      select: {
        id: true,
        name: true,
        periodMetrics: {
          where: {
            active: true,
            metric: { active: true },
          },
          select: { metricId: true },
        },
      },
    });
  });
});
