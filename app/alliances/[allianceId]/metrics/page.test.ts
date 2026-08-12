import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/src/lib/auth", () => ({}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

vi.mock("@/app/src/lib/setup/validateSetupPeriodReturnTo", () => ({
  validateSetupPeriodReturnTo: vi.fn(() => null),
}));

vi.mock("@/app/src/lib/periods/resolveTargetPeriod", () => ({
  resolveTargetPeriod: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/app/src/lib/featureFlags/evaluateFeature", () => ({
  evaluateFeature: vi.fn(),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    metric: {
      findMany: vi.fn(),
    },
  },
}));

import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { evaluateFeature } from "@/app/src/lib/featureFlags/evaluateFeature";
import { prisma } from "@/app/src/lib/prisma";
import MetricsPage from "./page";

const adminPermissions = {
  canViewAlliance: true,
  canViewMembers: true,
  canImportMetrics: true,
  canConfigureMetrics: true,
  canConfigurePeriods: true,
  canImportMembers: true,
};

function metricFixture() {
  return {
    id: "met_1",
    name: "VS Points",
    description: null,
    type: Metric_Type.NUMERIC,
    summaryKind: MetricSummaryKind.SUM,
    unitLabel: null,
    trendDirection: MetricTrendDirection.NEUTRAL,
    active: true,
    createdAt: new Date("2026-01-01"),
  } as unknown as Awaited<ReturnType<typeof prisma.metric.findMany>>[number];
}

async function renderPage() {
  const page = await MetricsPage({
    params: Promise.resolve({ allianceId: "all_1" }),
    searchParams: Promise.resolve({}),
  });
  return renderToStaticMarkup(page as React.ReactElement);
}

describe("Metrics Library page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      user: { id: "user_1", email: "owner@example.com" },
      membership: { allianceId: "all_1", role: "ADMIN" },
      permissions: adminPermissions,
    } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>);
    vi.mocked(prisma.metric.findMany).mockResolvedValue([metricFixture()]);
  });

  it("hides the per-metric 'View Report' link when the reports flag is off", async () => {
    vi.mocked(evaluateFeature).mockResolvedValue(false);

    const html = await renderPage();

    expect(html).not.toContain("View Report");
  });

  it("shows the per-metric 'View Report' link once the reports flag is on", async () => {
    vi.mocked(evaluateFeature).mockResolvedValue(true);

    const html = await renderPage();

    expect(html).toContain("View Report");
  });

  it("evaluates the reports flag with the resolved alliance/user context, not raw params", async () => {
    vi.mocked(evaluateFeature).mockResolvedValue(false);

    await renderPage();

    expect(evaluateFeature).toHaveBeenCalledWith(
      "reports",
      expect.objectContaining({
        alliance: { id: "all_1" },
        userId: "user_1",
      })
    );
  });
});
