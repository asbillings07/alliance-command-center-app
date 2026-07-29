import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("@/app/src/components", () => ({
  Badge: ({
    children,
    ...props
  }: React.HTMLAttributes<HTMLSpanElement>) =>
    React.createElement("span", props, children),
}));

vi.mock("@/app/src/lib/platform", () => ({
  getAllianceHealth: vi.fn(),
  getAllianceReadiness: vi.fn(),
  getActionRequiredBySeverity: vi.fn(),
  getSetupFunnel: vi.fn(),
  getRecentActivity: vi.fn(),
}));

import {
  getAllianceHealth,
  getAllianceReadiness,
  getActionRequiredBySeverity,
  getSetupFunnel,
  getRecentActivity,
} from "@/app/src/lib/platform";
import PlatformOverview from "./page";

describe("PlatformOverviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getAllianceHealth).mockResolvedValue({
      total: 1,
      activeToday: 0,
      newThisWeek: 0,
    });
    vi.mocked(getAllianceReadiness).mockResolvedValue([]);
    vi.mocked(getSetupFunnel).mockResolvedValue({
      stages: [],
      maxCount: 0,
    });
    vi.mocked(getRecentActivity).mockResolvedValue([]);
    vi.mocked(getActionRequiredBySeverity).mockResolvedValue({
      critical: [],
      warning: [],
      info: [],
      totalCount: 0,
      betaAttentionUnavailable: false,
    });
  });

  it("shows beta attention unavailable banner while preserving other items", async () => {
    vi.mocked(getActionRequiredBySeverity).mockResolvedValue({
      critical: [],
      warning: [
        {
          id: "old-collab-1",
          severity: "warning",
          title: "Pending collaborator invitation",
          description: "collab@example.test (Alliance) 10d",
          href: "/platform/support/alliance/alliance-1",
        },
      ],
      info: [],
      totalCount: 1,
      betaAttentionUnavailable: true,
    });

    const page = await PlatformOverview();
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-testid="beta-attention-unavailable"');
    expect(html).toContain("Beta attention is temporarily unavailable");
    expect(html).toContain('href="/platform/beta"');
    expect(html).toContain('href="/platform/overview"');
    expect(html).toContain("Pending collaborator invitation");
  });

  it("shows empty state only when no items and beta attention is available", async () => {
    const page = await PlatformOverview();
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No items require attention");
    expect(html).not.toContain('data-testid="beta-attention-unavailable"');
  });
});
