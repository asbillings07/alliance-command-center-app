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

vi.mock("@/app/src/lib/platform", () => ({
  getAllianceReadiness: vi.fn(),
  getActionRequiredBySeverity: vi.fn(),
}));

import {
  getAllianceReadiness,
  getActionRequiredBySeverity,
} from "@/app/src/lib/platform";
import PlatformSupport from "./page";

describe("PlatformSupportPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getActionRequiredBySeverity).mockResolvedValue({
      critical: [],
      warning: [],
      info: [],
      totalCount: 0,
      betaAttentionUnavailable: false,
    });
  });

  it("renders View support details on alliance cards with correct href", async () => {
    vi.mocked(getAllianceReadiness).mockResolvedValue([
      {
        id: "alliance-165",
        name: "Test Alliance",
        status: "needsSetup",
        progress: 50,
        lastActivity: new Date("2025-06-01T12:00:00Z"),
        createdAt: new Date("2025-05-01T12:00:00Z"),
        hasMetrics: true,
        hasPeriods: true,
        hasMembers: false,
        hasData: false,
      },
    ]);

    const page = await PlatformSupport();
    const html = renderToStaticMarkup(page);

    expect(html).toContain("View support details");
    expect(html).toContain('href="/platform/support/alliance/alliance-165"');
    expect(html).toContain(
      'aria-label="View support details for Test Alliance"'
    );
  });
});
