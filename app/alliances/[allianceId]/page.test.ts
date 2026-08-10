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

vi.mock("@/app/src/lib/features", () => ({
  isFeatureEnabled: vi.fn().mockReturnValue(false),
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
  },
}));

vi.mock("@/app/src/lib/metrics/memberPeriodMetricValues", () => ({
  memberPeriodMetricValues: vi.fn().mockResolvedValue([]),
}));

import { prisma } from "@/app/src/lib/prisma";
import { memberPeriodMetricValues } from "@/app/src/lib/metrics/memberPeriodMetricValues";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { isFeatureEnabled } from "@/app/src/lib/features";
import AlliancePage from "./page";
import { metricPeriodChronologicalOrderBy } from "@/app/src/lib/metricPeriodOrdering";

const adminPermissions = {
  canViewAlliance: true,
  canImportMetrics: true,
  canConfigureMetrics: true,
  canConfigurePeriods: true,
  canImportMembers: true,
  canManageMembers: true,
  canInviteCollaborators: true,
};

function mockAlliance() {
  vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
    id: "all_1",
    name: "Alliance One",
    server: "Server 100",
  } as unknown as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
}

describe("AllianceDashboardPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.metricPeriod.count).mockResolvedValue(1);
    vi.mocked(prisma.metric.count).mockResolvedValue(1);
    vi.mocked(prisma.allianceMember.count).mockResolvedValue(5);
    vi.mocked(prisma.allianceMembership.count).mockResolvedValue(1);
    vi.mocked(prisma.invitation.count).mockResolvedValue(0);
    vi.mocked(memberPeriodMetricValues).mockResolvedValue([]);
    vi.mocked(isFeatureEnabled).mockReturnValue(false);
  });

  it("renders Record Now and Import Evaluation Results when prerequisites are met", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "ADMIN" },
      permissions: adminPermissions,
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockAlliance();

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

    expect(html).toContain("Record Now");
    expect(html).toContain("Import Evaluation Results");
    expect(html).toContain("/alliances/all_1/periods/per_1/record");
    expect(html).toContain("/alliances/all_1/periods/per_1/import");
  });

  it("shows no-period guidance instead of omitting Evaluation Results", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "ADMIN" },
      permissions: adminPermissions,
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockAlliance();
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.metricPeriod.count).mockResolvedValue(0);

    const page = await AlliancePage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No evaluation periods yet");
    expect(html).toContain("Go to Evaluation Periods");
    expect(html).not.toContain("Record Now");
  });

  it("distinguishes archived-only periods in the no-period card", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "ADMIN" },
      permissions: adminPermissions,
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockAlliance();
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.metricPeriod.count).mockResolvedValue(2);

    const page = await AlliancePage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Only inactive evaluation periods exist");
  });

  it("hides Record and Import when there are no active members", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "ADMIN" },
      permissions: adminPermissions,
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockAlliance();
    vi.mocked(prisma.allianceMember.count).mockResolvedValue(0);
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

    expect(html).not.toContain("Record Now");
    expect(html).not.toContain("Import Evaluation Results");
    expect(html).toContain("Import Members");
  });

  it("shows import-only guidance when metrics can be provisioned during import", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "LEADER" },
      permissions: {
        canViewAlliance: true,
        canImportMetrics: true,
        canConfigureMetrics: true,
        canConfigurePeriods: true,
        canImportMembers: false,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockAlliance();
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_empty",
      name: "Week 31 Evaluation",
      active: true,
      periodMetrics: [],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);
    vi.mocked(prisma.metric.count).mockResolvedValue(2);

    const page = await AlliancePage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain("Record Now");
    expect(html).toContain("Import Evaluation Results");
    expect(html).toContain("/alliances/all_1/periods/per_empty/import");
    expect(html).not.toContain("Manage Period Metrics");
  });

  it("shows manage-period guidance when import cannot provision metrics", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "LEADER" },
      permissions: {
        canViewAlliance: true,
        canImportMetrics: true,
        canConfigureMetrics: false,
        canConfigurePeriods: false,
        canImportMembers: false,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockAlliance();
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_empty",
      name: "Week 31 Evaluation",
      active: true,
      periodMetrics: [],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);
    vi.mocked(prisma.metric.count).mockResolvedValue(0);

    const page = await AlliancePage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain("Record Now");
    expect(html).not.toContain("/alliances/all_1/periods/per_empty/import");
    expect(html).toContain("View Period");
  });

  it("uses deterministic ordering when querying active period", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      membership: { role: "ADMIN" },
      permissions: {
        canViewAlliance: true,
        canImportMetrics: true,
      },
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    mockAlliance();
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

  describe("Reports module card — FEATURE_REPORTS gate (#190)", () => {
    async function renderWithViewMembers() {
      vi.mocked(requireAllianceAccess).mockResolvedValue({
        membership: { role: "ADMIN" },
        permissions: { ...adminPermissions, canViewMembers: true },
      } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
      mockAlliance();
      vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(null);

      const page = await AlliancePage({ params: Promise.resolve({ allianceId: "all_1" }) });
      return renderToStaticMarkup(page);
    }

    it("hides the Reports card for a permitted viewer when the flag is off", async () => {
      vi.mocked(isFeatureEnabled).mockReturnValue(false);
      const html = await renderWithViewMembers();
      expect(html).not.toContain("View Reports");
    });

    it("shows the Reports card for a permitted viewer once the flag is on", async () => {
      vi.mocked(isFeatureEnabled).mockReturnValue(true);
      const html = await renderWithViewMembers();
      expect(html).toContain("View Reports");
      expect(html).toContain("/alliances/all_1/reports");
    });
  });
});
