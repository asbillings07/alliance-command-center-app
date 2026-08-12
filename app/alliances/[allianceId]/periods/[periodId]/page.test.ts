import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));

vi.mock("@/app/src/lib/auth", () => ({}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

vi.mock("@/app/src/lib/reports/getPeriodResultsSummary", () => ({
  getPeriodResultsSummary: vi.fn(),
}));

vi.mock("@/app/src/lib/featureFlags/evaluateFeature", () => ({
  evaluateFeature: vi.fn().mockResolvedValue(false),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metricPeriod: {
      findFirst: vi.fn(),
    },
    metric: {
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
    },
  },
}));

import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { getPeriodResultsSummary } from "@/app/src/lib/reports/getPeriodResultsSummary";
import { evaluateFeature } from "@/app/src/lib/featureFlags/evaluateFeature";
import PeriodPage from "./page";

const adminPermissions = {
  canViewAlliance: true,
  canViewMembers: true,
  canImportMetrics: true,
  canConfigureMetrics: true,
  canConfigurePeriods: true,
  canImportMembers: true,
};

describe("Period detail page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: adminPermissions,
    } as Awaited<ReturnType<typeof requireAllianceAccess>>);
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_1",
      name: "Week 30",
      startsAt: null,
      endsAt: null,
      periodMetrics: [{ metricId: "met_1", metric: { name: "VS" }, weight: 1, required: false }],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);
    vi.mocked(getPeriodResultsSummary).mockResolvedValue({
      participatingMemberCount: 3,
      currentActiveMemberCount: 5,
      participatingActiveMemberCount: 3,
      metrics: [],
    });
    vi.mocked(prisma.metric.count).mockResolvedValue(0);
    vi.mocked(evaluateFeature).mockResolvedValue(false);
  });

  it("shows Record and Import when prerequisites are met", async () => {
    const page = await PeriodPage({
      params: Promise.resolve({ allianceId: "all_1", periodId: "per_1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Record Results");
    expect(html).toContain("Import Evaluation Results");
  });

  it("replaces zero-member coverage stats with import guidance", async () => {
    vi.mocked(getPeriodResultsSummary).mockResolvedValue({
      participatingMemberCount: 0,
      currentActiveMemberCount: 0,
      participatingActiveMemberCount: 0,
      metrics: [],
    });

    const page = await PeriodPage({
      params: Promise.resolve({ allianceId: "all_1", periodId: "per_1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No active members yet");
    expect(html).toContain("Import Members");
    expect(html).not.toContain("Record Results");
    expect(html).not.toContain("Import Evaluation Results");
  });

  it("shows import-only actions when metrics can be provisioned", async () => {
    vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue({
      id: "per_1",
      name: "Week 30",
      startsAt: null,
      endsAt: null,
      periodMetrics: [],
    } as unknown as Awaited<ReturnType<typeof prisma.metricPeriod.findFirst>>);
    vi.mocked(prisma.metric.count).mockResolvedValue(2);

    const page = await PeriodPage({
      params: Promise.resolve({ allianceId: "all_1", periodId: "per_1" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).not.toContain("Record Results");
    expect(html).toContain("Import Evaluation Results");
  });

  describe("metric coverage 'View Report' link — reports flag gate (#190)", () => {
    beforeEach(() => {
      vi.mocked(getPeriodResultsSummary).mockResolvedValue({
        participatingMemberCount: 3,
        currentActiveMemberCount: 5,
        participatingActiveMemberCount: 3,
        metrics: [{ metricId: "met_1", metricName: "VS", activeMemberCount: 3, memberCount: 3 }],
      });
    });

    it("hides the link when the flag is off, even though the viewer can view members", async () => {
      vi.mocked(evaluateFeature).mockResolvedValue(false);

      const page = await PeriodPage({
        params: Promise.resolve({ allianceId: "all_1", periodId: "per_1" }),
      });
      const html = renderToStaticMarkup(page);

      expect(html).not.toContain("View Report");
    });

    it("shows the link once the flag is on", async () => {
      vi.mocked(evaluateFeature).mockResolvedValue(true);

      const page = await PeriodPage({
        params: Promise.resolve({ allianceId: "all_1", periodId: "per_1" }),
      });
      const html = renderToStaticMarkup(page);

      expect(html).toContain("View Report");
      expect(html).toContain("/alliances/all_1/reports/metrics/met_1?periodId=per_1");
    });
  });
});
