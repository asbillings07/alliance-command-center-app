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
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
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
    allianceMember: {
      findMany: vi.fn(),
    },
    metricPeriod: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
    metric: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("./SetupImportForm", () => ({
  SetupImportForm: ({
    hasArchivedPeriodsOnly,
  }: {
    hasArchivedPeriodsOnly: boolean;
  }) =>
    React.createElement("div", {
      "data-testid": "setup-import-form",
      "data-archived-only": String(hasArchivedPeriodsOnly),
    }),
}));

import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import SetupImportPage from "./page";

describe("SetupImportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks upload UI until members exist and links import-capable viewers to member import with returnTo", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMetrics: true,
        canImportMembers: true,
        canConfigureMetrics: true,
        canConfigurePeriods: true,
      },
    } as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.metricPeriod.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([]);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([]);
    vi.mocked(prisma.metric.findMany).mockResolvedValue([]);

    const page = await SetupImportPage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain("Import members first");
    expect(html).toContain("separate uploads");
    expect(html).toContain(
      `/alliances/all_1/members/import?returnTo=${encodeURIComponent("/alliances/all_1/setup/import")}`,
    );
    expect(html).not.toContain("setup-import-form");
  });

  it("shows blocked explanation without import link when viewer lacks IMPORT_MEMBERS", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMetrics: true,
        canImportMembers: false,
        canConfigureMetrics: true,
        canConfigurePeriods: true,
      },
    } as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.metricPeriod.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([]);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([]);
    vi.mocked(prisma.metric.findMany).mockResolvedValue([]);

    const page = await SetupImportPage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain("Ask an Admin or Owner");
    expect(html).not.toContain("/members/import?returnTo=");
  });

  it("passes archived-only guidance to the guided import form when only archived periods exist", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      permissions: {
        canImportMetrics: true,
        canImportMembers: true,
        canConfigureMetrics: true,
        canConfigurePeriods: true,
      },
    } as Awaited<ReturnType<typeof requireAllianceAccess>>);

    vi.mocked(prisma.alliance.findUnique).mockResolvedValue({
      id: "all_1",
      name: "Alliance One",
    } as Awaited<ReturnType<typeof prisma.alliance.findUnique>>);
    vi.mocked(prisma.metricPeriod.count)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(2);
    vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([
      { id: "mem_1", playerName: "Dragon" },
    ] as Awaited<ReturnType<typeof prisma.allianceMember.findMany>>);
    vi.mocked(prisma.metricPeriod.findMany).mockResolvedValue([]);
    vi.mocked(prisma.metric.findMany).mockResolvedValue([
      { id: "met_1", name: "Kills" },
    ] as Awaited<ReturnType<typeof prisma.metric.findMany>>);

    const page = await SetupImportPage({
      params: Promise.resolve({ allianceId: "all_1" }),
    });

    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-testid="setup-import-form"');
    expect(html).toContain('data-archived-only="true"');
  });
});
