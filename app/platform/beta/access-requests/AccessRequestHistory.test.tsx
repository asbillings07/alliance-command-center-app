/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccessRequestTriageHistoryItem } from "@/app/src/lib/platform/accessRequestInbox";

vi.mock("@/app/src/components/client", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", props, children),
}));

const mockFetchHistory = vi.fn();
vi.mock("./actions", () => ({
  fetchAccessRequestHistoryAction: (...args: unknown[]) => mockFetchHistory(...args),
}));

import { AccessRequestHistory } from "./AccessRequestHistory";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function buildEvent(overrides: Partial<AccessRequestTriageHistoryItem> = {}): AccessRequestTriageHistoryItem {
  return {
    id: "evt_1",
    eventType: "NOTE_ADDED",
    previousStatus: null,
    nextStatus: null,
    actorEmail: "op@example.test",
    actorDisplayName: "Operator",
    createdAt: new Date("2026-07-29T12:00:00Z"),
    noteText: "Checked in",
    declineReason: null,
    resolutionReason: null,
    reopenReason: null,
    betaWave: null,
    blockedReason: null,
    blockedConflictType: null,
    conflictUserEmail: null,
    conflictUserDisplayName: null,
    conflictAllianceName: null,
    conflictMembershipCount: null,
    linkedInvitationId: null,
    ...overrides,
  };
}

let container: HTMLDivElement;
let root: Root;

async function mount(accessRequestId = "ar_1", refreshSignal = 0) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(AccessRequestHistory, { accessRequestId, refreshSignal }));
  });
}

async function rerenderWithRefreshSignal(accessRequestId: string, refreshSignal: number) {
  await act(async () => {
    root.render(createElement(AccessRequestHistory, { accessRequestId, refreshSignal }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

function toggleButton() {
  return container.querySelector<HTMLButtonElement>('[data-testid="access-request-history-toggle"]');
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("AccessRequestHistory", () => {
  it("loads nothing until 'Show history' is clicked", async () => {
    await mount();
    expect(mockFetchHistory).not.toHaveBeenCalled();
    expect(toggleButton()?.textContent).toBe("Show history");
  });

  it("loads the 5 newest events on open and renders their summaries", async () => {
    mockFetchHistory.mockResolvedValue({
      success: true,
      items: [buildEvent({ id: "evt_1" }), buildEvent({ id: "evt_2", eventType: "DECLINED", declineReason: "Spam" })],
      total: 7,
      page: 1,
      pageSize: 5,
    });

    await mount();
    await act(async () => {
      toggleButton()?.click();
    });

    expect(mockFetchHistory).toHaveBeenCalledWith("ar_1", 1, 5);
    expect(container.textContent).toContain("Note added");
    expect(container.textContent).toContain("Declined");
    expect(container.textContent).toContain("Operator (op@example.test)");
  });

  it("shows a 'View full history' link only when more events exist than the compact page, switches to real pagination, and Next/Previous actually navigate distinct pages", async () => {
    mockFetchHistory.mockResolvedValue({
      success: true,
      items: [buildEvent()],
      total: 12,
      page: 1,
      pageSize: 5,
    });

    await mount();
    await act(async () => {
      toggleButton()?.click();
    });

    const viewFull = container.querySelector<HTMLButtonElement>(
      '[data-testid="access-request-history-view-full"]',
    );
    expect(viewFull?.textContent).toBe("View full history (12)");

    // 12 events, FULL_PAGE_SIZE=10 -> page 1 has the 10 newest, page 2 has
    // the 2 oldest. Distinct ids per page let this test prove Next/Previous
    // load different data rather than re-rendering the same items twice
    // (review feedback: the original test never actually clicked Next).
    const page1Items = Array.from({ length: 10 }, (_, i) => buildEvent({ id: `evt_p1_${i}`, noteText: `Page1 #${i}` }));
    const page2Items = [
      buildEvent({ id: "evt_p2_0", noteText: "Page2 #0 (oldest)" }),
      buildEvent({ id: "evt_p2_1", noteText: "Page2 #1" }),
    ];
    mockFetchHistory.mockResolvedValue({
      success: true,
      items: page1Items,
      total: 12,
      page: 1,
      pageSize: 10,
    });

    await act(async () => {
      viewFull?.click();
    });

    expect(mockFetchHistory).toHaveBeenLastCalledWith("ar_1", 1, 10);
    expect(container.textContent).toContain("Page 1 of 2");
    expect(container.textContent).toContain("Page1 #0");
    expect(container.textContent).toContain("Page1 #9");
    expect(container.textContent).not.toContain("Page2 #0");
    // The compact-mode "view full history" link should no longer render.
    expect(container.querySelector('[data-testid="access-request-history-view-full"]')).toBeNull();

    mockFetchHistory.mockResolvedValue({
      success: true,
      items: page2Items,
      total: 12,
      page: 2,
      pageSize: 10,
    });
    const nextButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Next",
    );
    await act(async () => {
      nextButton?.click();
    });

    expect(mockFetchHistory).toHaveBeenLastCalledWith("ar_1", 2, 10);
    expect(container.textContent).toContain("Page 2 of 2");
    expect(container.textContent).toContain("Page2 #0 (oldest)");
    expect(container.textContent).toContain("Page2 #1");
    // Page 1's items must be gone, not accumulated alongside page 2's — no
    // silent duplication/loss across pages.
    expect(container.textContent).not.toContain("Page1 #0");

    mockFetchHistory.mockResolvedValue({
      success: true,
      items: page1Items,
      total: 12,
      page: 1,
      pageSize: 10,
    });
    const previousButton = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent === "Previous",
    );
    await act(async () => {
      previousButton?.click();
    });

    expect(mockFetchHistory).toHaveBeenLastCalledWith("ar_1", 1, 10);
    expect(container.textContent).toContain("Page 1 of 2");
    expect(container.textContent).toContain("Page1 #0");
    expect(container.textContent).not.toContain("Page2 #0");
  });

  it("does not show 'View full history' when total fits within the compact page", async () => {
    mockFetchHistory.mockResolvedValue({
      success: true,
      items: [buildEvent()],
      total: 3,
      page: 1,
      pageSize: 5,
    });

    await mount();
    await act(async () => {
      toggleButton()?.click();
    });

    expect(container.querySelector('[data-testid="access-request-history-view-full"]')).toBeNull();
  });

  it("renders a visible error and does not clear it silently on a fresh open", async () => {
    mockFetchHistory.mockResolvedValue({ success: false, error: "Access request not found" });

    await mount();
    await act(async () => {
      toggleButton()?.click();
    });

    expect(container.querySelector('[data-testid="access-request-history-error"]')?.textContent).toBe(
      "Access request not found",
    );
  });

  it("shows an empty-state message when there are zero events", async () => {
    mockFetchHistory.mockResolvedValue({ success: true, items: [], total: 0, page: 1, pageSize: 5 });

    await mount();
    await act(async () => {
      toggleButton()?.click();
    });

    expect(container.textContent).toContain("No history events yet.");
  });

  it("collapses without refetching, then does not refetch on re-open since data is already loaded", async () => {
    mockFetchHistory.mockResolvedValue({ success: true, items: [buildEvent()], total: 1, page: 1, pageSize: 5 });

    await mount();
    await act(async () => {
      toggleButton()?.click();
    });
    expect(mockFetchHistory).toHaveBeenCalledTimes(1);

    await act(async () => {
      toggleButton()?.click(); // hide
    });
    expect(toggleButton()?.textContent).toBe("Show history");

    await act(async () => {
      toggleButton()?.click(); // re-open
    });
    expect(mockFetchHistory).toHaveBeenCalledTimes(1);
  });

  it("shows a visible error, rather than failing silently, when the fetch rejects outright", async () => {
    // fetchAccessRequestHistoryAction can reject (e.g. requirePlatformAdmin
    // throws on an expired session) rather than resolving with
    // { success: false } — review feedback on PR #260.
    mockFetchHistory.mockRejectedValueOnce(new Error("session expired"));

    await mount();
    await act(async () => {
      toggleButton()?.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="access-request-history-error"]')?.textContent).toBe(
      "session expired",
    );
  });

  it("reloads an already-loaded history from page 1 when refreshSignal changes, but does nothing if it was never opened", async () => {
    mockFetchHistory.mockResolvedValue({
      success: true,
      items: [buildEvent({ id: "evt_old" })],
      total: 1,
      page: 1,
      pageSize: 5,
    });

    await mount("ar_1", 0);
    // Never opened: a refreshSignal bump before the operator ever looks at
    // history must not trigger a wasted fetch — the next open already gets
    // fresh data.
    await rerenderWithRefreshSignal("ar_1", 1);
    await flush();
    expect(mockFetchHistory).not.toHaveBeenCalled();

    await act(async () => {
      toggleButton()?.click();
    });
    expect(mockFetchHistory).toHaveBeenCalledTimes(1);

    // Now it's loaded: a later mutation (e.g. approve/decline while this
    // panel's history is expanded) must be reflected without the operator
    // manually closing and reopening it (review feedback: "history stays
    // stale after a mutation").
    mockFetchHistory.mockResolvedValue({
      success: true,
      items: [buildEvent({ id: "evt_new", noteText: "Just added" })],
      total: 2,
      page: 1,
      pageSize: 5,
    });
    await rerenderWithRefreshSignal("ar_1", 2);
    await flush();

    expect(mockFetchHistory).toHaveBeenCalledTimes(2);
    expect(mockFetchHistory).toHaveBeenLastCalledWith("ar_1", 1, 5);
    expect(container.textContent).toContain("Just added");
  });
});
