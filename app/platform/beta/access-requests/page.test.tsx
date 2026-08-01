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
  AccessRequestSummaryCards: vi.fn(() => React.createElement("div", null, "Summary cards")),
}));

vi.mock("./AccessRequestList", () => ({
  AccessRequestList: ({ items }: { items: { accessRequestId: string }[] }) =>
    React.createElement(
      "div",
      null,
      items.map((item) => `Row ${item.accessRequestId}`).join(", "),
    ),
}));

vi.mock("./AccessRequestQueueUnavailable", () => ({
  AccessRequestQueueUnavailable: () =>
    React.createElement("div", { "data-testid": "mock-queue-unavailable" }, "Queue unavailable"),
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

  it("renders a recoverable, scoped error state instead of letting a rejected read model escape the route", async () => {
    // Review feedback on PR #260: "the queue's initial read has no
    // deliberate error state" — a thrown listAccessRequestsForTriage()
    // previously escaped into Next.js's generic error boundary.
    vi.mocked(listAccessRequestsForTriage).mockRejectedValue(new Error("db down"));

    const page = await AccessRequestsPage({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-testid="platform-access-requests-page"');
    // Still on a route scoped to Beta / Access requests — the breadcrumb
    // survives even though the queue itself failed.
    expect(html).toContain("Beta");
    expect(html).toContain('data-testid="mock-queue-unavailable"');
    expect(html).not.toContain("Summary cards");
  });

  it("builds summary-card/filter URL state from the read model's clamped page/pageSize, not the raw parsed params", async () => {
    // Review feedback on PR #260: an out-of-range `?pageSize=999&page=999999`
    // previously leaked unchanged into navigation links even though the
    // read model actually clamped and rendered a different page/size.
    vi.mocked(listAccessRequestsForTriage).mockResolvedValue({
      items: [sampleItem],
      total: 1,
      page: 3, // what the read model actually clamped to
      pageSize: 50, // what the read model actually clamped to
      statusCounts: { ...emptyStatusCounts, PENDING: 1 },
    });

    const page = await AccessRequestsPage({
      searchParams: Promise.resolve({ page: "999999", pageSize: "999" }),
    });
    renderToStaticMarkup(page);

    // AccessRequestFilters already receives result.page/result.pageSize
    // directly; this asserts the *shared* urlState (summary cards) matches
    // rather than the raw, unclamped request params.
    const { AccessRequestSummaryCards } = await import("./AccessRequestSummaryCards");
    expect(vi.mocked(AccessRequestSummaryCards).mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        urlState: expect.objectContaining({ page: "3", pageSize: "50" }),
      }),
    );
  });
});
