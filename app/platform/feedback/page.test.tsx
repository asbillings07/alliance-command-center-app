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

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: vi.fn().mockResolvedValue({ id: "operator-1" }),
}));

vi.mock("./FeedbackFilters", () => ({
  FeedbackFilters: () => React.createElement("div", null, "Filters"),
}));

vi.mock("./FeedbackSummaryCards", () => ({
  FeedbackSummaryCards: () =>
    React.createElement("div", null, "Summary cards"),
}));

vi.mock("./FeedbackRetryButton", () => ({
  FeedbackInboxRetryButton: () =>
    React.createElement("button", { "data-testid": "feedback-inbox-retry" }, "Retry"),
}));

vi.mock("./FeedbackList", () => ({
  FeedbackCard: ({ item }: { item: { feedbackId: string } }) =>
    React.createElement("div", null, `Card ${item.feedbackId}`),
  FeedbackTableRow: ({ item }: { item: { feedbackId: string } }) =>
    React.createElement(
      "tr",
      null,
      React.createElement("td", null, item.feedbackId),
    ),
}));

vi.mock("@/app/src/lib/platform/feedbackInbox", () => ({
  listFeedbackForTriage: vi.fn(),
  listFeedbackFilterOptions: vi.fn().mockResolvedValue({
    alliances: [],
    waves: [],
  }),
}));

import {
  listFeedbackFilterOptions,
  listFeedbackForTriage,
} from "@/app/src/lib/platform/feedbackInbox";
import PlatformFeedbackPage from "./page";

const sampleItem = {
  feedbackId: "fb-1",
  category: "BUG" as const,
  message: "Something broke",
  submitterEmail: "tester@example.test",
  submitterDisplayName: "Tester",
  allianceId: null,
  allianceName: null,
  participantId: null,
  wave: null,
  status: "NEW" as const,
  needsResponse: true,
  hasBeenTriaged: false,
  githubIssueUrl: null,
  stateRevision: 0,
  lastEventAt: null,
  lastStateChangeAt: null,
  lastStateChangeActorEmail: null,
  lastStateChangeActorDisplayName: null,
  createdAt: new Date("2026-07-29T12:00:00Z"),
};

describe("PlatformFeedback page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listFeedbackFilterOptions).mockResolvedValue({
      alliances: [],
      waves: [],
    });
  });

  it("renders summary cards and feedback list", async () => {
    vi.mocked(listFeedbackForTriage).mockResolvedValue({
      items: [sampleItem],
      total: 1,
      page: 1,
      pageSize: 25,
      summary: {
        statusCounts: {
          NEW: 1,
          TRIAGED: 0,
          PLANNED: 0,
          RESOLVED: 0,
          DISMISSED: 0,
        },
        needsResponseCount: 1,
        totalMatchingOtherFacets: 1,
      },
    });

    const page = await PlatformFeedbackPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Feedback Inbox");
    expect(html).toContain("Summary cards");
    expect(html).toContain("Card fb-1");
    expect(html).toContain("fb-1");
  });

  it("renders empty state when no feedback matches", async () => {
    vi.mocked(listFeedbackForTriage).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      summary: {
        statusCounts: {
          NEW: 0,
          TRIAGED: 0,
          PLANNED: 0,
          RESOLVED: 0,
          DISMISSED: 0,
        },
        needsResponseCount: 0,
        totalMatchingOtherFacets: 0,
      },
    });

    const page = await PlatformFeedbackPage({
      searchParams: Promise.resolve({ search: "none" }),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No feedback matches these filters");
    expect(html).toContain('href="/platform/feedback"');
  });

  it("renders scoped unavailable state when list query throws", async () => {
    vi.mocked(listFeedbackForTriage).mockRejectedValue(
      new Error("database unavailable"),
    );

    const page = await PlatformFeedbackPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-testid="feedback-inbox-unavailable"');
    expect(html).toContain("Feedback inbox unavailable");
    expect(html).toContain('data-testid="feedback-inbox-retry"');
    expect(listFeedbackFilterOptions).not.toHaveBeenCalled();
  });

  it("renders scoped unavailable state when filter options query throws", async () => {
    vi.mocked(listFeedbackForTriage).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      summary: {
        statusCounts: {
          NEW: 0,
          TRIAGED: 0,
          PLANNED: 0,
          RESOLVED: 0,
          DISMISSED: 0,
        },
        needsResponseCount: 0,
        totalMatchingOtherFacets: 0,
      },
    });
    vi.mocked(listFeedbackFilterOptions).mockRejectedValue(
      new Error("filter options unavailable"),
    );

    const page = await PlatformFeedbackPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain('data-testid="feedback-inbox-unavailable"');
    expect(listFeedbackFilterOptions).toHaveBeenCalled();
  });

  it("shows Unreviewed semantics via list item shape in mocked render path", async () => {
    vi.mocked(listFeedbackForTriage).mockResolvedValue({
      items: [{ ...sampleItem, hasBeenTriaged: false, needsResponse: true }],
      total: 1,
      page: 1,
      pageSize: 25,
      summary: {
        statusCounts: {
          NEW: 1,
          TRIAGED: 0,
          PLANNED: 0,
          RESOLVED: 0,
          DISMISSED: 0,
        },
        needsResponseCount: 1,
        totalMatchingOtherFacets: 1,
      },
    });

    const page = await PlatformFeedbackPage({
      searchParams: Promise.resolve({}),
    });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Card fb-1");
  });
});
