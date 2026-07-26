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
      count: vi.fn(),
    },
    metric: {
      count: vi.fn(),
    },
    allianceMembership: {
      count: vi.fn(),
    },
    invitation: {
      count: vi.fn(),
    },
    allianceMember: {
      count: vi.fn(),
    },
    memberMetricEntry: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import AllianceSetupPage from "./page";

function mockFreshAllianceCounts() {
  vi.mocked(prisma.metric.count).mockResolvedValue(0);
  vi.mocked(prisma.metricPeriod.count).mockResolvedValue(0);
  vi.mocked(prisma.allianceMembership.count).mockResolvedValue(1);
  vi.mocked(prisma.invitation.count).mockResolvedValue(0);
  vi.mocked(prisma.allianceMember.count).mockResolvedValue(0);
  vi.mocked(prisma.memberMetricEntry.count).mockResolvedValue(0);
  vi.mocked(prisma.metricPeriod.findFirst).mockResolvedValue(null);
}

describe("AllianceSetupPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders spreadsheet-first entry choice and manual-setup anchor", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMetrics: true,
        canImportMembers: true,
        canConfigureMetrics: true,
        canConfigurePeriods: true,
        canInviteCollaborators: true,
      },
    } as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    mockFreshAllianceCounts();

    const page = await AllianceSetupPage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain("How would you like to get started?");
    expect(html).toContain("Start with a spreadsheet");
    expect(html).toContain("/alliances/all_1/setup/import");
    expect(html).toContain('href="#manual-setup"');
    expect(html).toContain("Set up manually");
    expect(html).toContain('id="manual-setup"');
  });

  it("renders required tasks in period-first order with team last", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMetrics: true,
        canImportMembers: true,
        canConfigureMetrics: true,
        canConfigurePeriods: true,
        canInviteCollaborators: true,
      },
    } as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    mockFreshAllianceCounts();

    const page = await AllianceSetupPage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });

    const html = renderToStaticMarkup(page);

    const periodIndex = html.indexOf("Create Evaluation Period");
    const metricsIndex = html.indexOf("Configure Metrics");
    const membersIndex = html.indexOf("Import Members");
    const dataIndex = html.indexOf("Import Evaluation Results");
    const teamIndex = html.indexOf("Invite Leadership Team");

    expect(periodIndex).toBeGreaterThan(-1);
    expect(metricsIndex).toBeGreaterThan(periodIndex);
    expect(membersIndex).toBeGreaterThan(metricsIndex);
    expect(dataIndex).toBeGreaterThan(membersIndex);
    expect(teamIndex).toBeGreaterThan(dataIndex);
  });

  it("renders blockedReason for data task when members are missing", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMetrics: true,
        canImportMembers: false,
        canConfigureMetrics: true,
        canConfigurePeriods: true,
        canInviteCollaborators: false,
      },
    } as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    mockFreshAllianceCounts();

    const page = await AllianceSetupPage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain(
      "An Admin or Owner must import members before you can import evaluation results.",
    );
    expect(html).toContain(
      '<div class="font-medium text-text-primary">Import Evaluation Results</div>',
    );
    expect(html).not.toContain(
      '<a href="/alliances/all_1/periods" class="block p-4"><div class="flex items-start gap-3"><div class="mt-0.5"><div class="w-5 h-5 rounded-full border-2 border-border-hover"></div></div><div class="flex-1"><div class="font-medium text-text-primary">Import Evaluation Results</div>',
    );
  });
});
