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

async function mount(accessRequestId = "ar_1") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(AccessRequestHistory, { accessRequestId }));
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

  it("shows a 'View full history' link only when more events exist than the compact page, and switches to real pagination", async () => {
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

    mockFetchHistory.mockResolvedValue({
      success: true,
      items: [buildEvent()],
      total: 12,
      page: 1,
      pageSize: 10,
    });

    await act(async () => {
      viewFull?.click();
    });

    expect(mockFetchHistory).toHaveBeenLastCalledWith("ar_1", 1, 10);
    expect(container.textContent).toContain("Page 1 of 2");
    // The compact-mode "view full history" link should no longer render.
    expect(container.querySelector('[data-testid="access-request-history-view-full"]')).toBeNull();
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
});
