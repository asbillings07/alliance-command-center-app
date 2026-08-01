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

vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn().mockResolvedValue({ id: "operator-1" }),
}));

vi.mock("./AccessRequestFilters", () => ({
  AccessRequestFilters: () => React.createElement("div", null, "Filters"),
}));

vi.mock("./AccessRequestSummaryCards", () => ({
  AccessRequestSummaryCards: () => React.createElement("div", null, "Summary cards"),
}));

vi.mock("./AccessRequestList", () => ({
  AccessRequestList: ({ items }: { items: { accessRequestId: string }[] }) =>
    React.createElement(
      "div",
      null,
      items.map((item) => `Row ${item.accessRequestId}`).join(", "),
    ),
}));

vi.mock("@/app/src/lib/platform/accessRequestInbox", () => ({
  listAccessRequestsForTriage: vi.fn(),
}));

import { listAccessRequestsForTriage } from "@/app/src/lib/platform/accessRequestInbox";
import AccessRequestsPage from "./page";

const sampleItem = {
  accessRequestId: "ar-1",
  name: "Tester One",
  email: "one@example.test",
  allianceName: null,
  message: "Let me in",
  createdAt: new Date("2026-07-29T12:00:00Z"),
  status: "PENDING" as const,
  betaWave: null,
  linkedInvitationId: null,
  currentReason: null,
  stateRevision: 0,
  lastEventAt: null,
  lastEventActorEmail: null,
  lastEventActorDisplayName: null,
  lastStateChangeAt: null,
  lastStateChangeActorEmail: null,
  lastStateChangeActorDisplayName: null,
};

const emptyStatusCounts = {
  PENDING: 0,
  INVITED: 0,
  DECLINED: 0,
  RESOLVED_EXISTING_ACCESS: 0,
};

describe("AccessRequestsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the Beta / Access requests breadcrumb, back link, summary cards, and the queue", async () => {
    vi.mocked(listAccessRequestsForTriage).mockResolvedValue({
      items: [sampleItem],
      total: 1,
      page: 1,
      pageSize: 20,
      statusCounts: { ...emptyStatusCounts, PENDING: 1 },
    });

    const page = await AccessRequestsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-testid="platform-access-requests-page"');
    expect(html).toContain("Beta");
    expect(html).toContain("Access requests");
    expect(html).toContain('data-testid="back-to-beta-participants"');
    expect(html).toContain("← Back to Beta participants");
    expect(html).toContain('href="/platform/beta"');
    expect(html).toContain("Summary cards");
    expect(html).toContain("Row ar-1");
  });

  it("renders an empty state with a clear-filters link when no requests match", async () => {
    vi.mocked(listAccessRequestsForTriage).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      statusCounts: emptyStatusCounts,
    });

    const page = await AccessRequestsPage({
      searchParams: Promise.resolve({ search: "nobody" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No access requests match these filters.");
    expect(html).toContain("Clear filters");
    expect(html).toContain('href="/platform/beta/access-requests"');
  });

  it("passes the parsed status filter through to the read model", async () => {
    vi.mocked(listAccessRequestsForTriage).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      statusCounts: emptyStatusCounts,
    });

    await AccessRequestsPage({
      searchParams: Promise.resolve({ status: "DECLINED", page: "2" }),
    });

    expect(listAccessRequestsForTriage).toHaveBeenCalledWith(
      { status: "DECLINED", search: undefined },
      2,
      20,
    );
  });

  it("ignores an invalid status value rather than passing it through", async () => {
    vi.mocked(listAccessRequestsForTriage).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 20,
      statusCounts: emptyStatusCounts,
    });

    await AccessRequestsPage({
      searchParams: Promise.resolve({ status: "NOT_A_REAL_STATUS" }),
    });

    expect(listAccessRequestsForTriage).toHaveBeenCalledWith(
      { status: undefined, search: undefined },
      1,
      20,
    );
  });
});
