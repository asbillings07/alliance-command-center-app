/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AccessRequestInboxListItem } from "@/app/src/lib/platform/accessRequestInbox";
import type { WaveOptionsState } from "./AccessRequestActionsPanel";

vi.mock("@/app/src/components/client", () => ({
  Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
    React.createElement("button", props, children),
}));

vi.mock("./AccessRequestActionsPanel", () => ({
  // Mimics the one real behavior this test cares about: the real panel's
  // BetaWaveSelect calls onRequestWaveOptions once on mount, and a real
  // Retry button calls it again from the "error" state.
  AccessRequestActionsPanel: ({
    item,
    waveOptionsState,
    onRequestWaveOptions,
  }: {
    item: { accessRequestId: string };
    waveOptionsState: WaveOptionsState;
    onRequestWaveOptions: () => void;
  }) => {
    React.useEffect(() => {
      onRequestWaveOptions();
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    const label =
      waveOptionsState.status === "loaded"
        ? `waveOptionsState:loaded:${waveOptionsState.waves.length}`
        : `waveOptionsState:${waveOptionsState.status}`;
    return React.createElement(
      "div",
      { "data-testid": `mock-panel-${item.accessRequestId}` },
      label,
      waveOptionsState.status === "error" &&
        React.createElement(
          "button",
          {
            type: "button",
            "data-testid": `mock-retry-${item.accessRequestId}`,
            onClick: onRequestWaveOptions,
          },
          "Retry",
        ),
    );
  },
}));

const mockFetchWaveOptions = vi.fn();
vi.mock("./actions", () => ({
  fetchBetaWaveOptionsAction: (...args: unknown[]) => mockFetchWaveOptions(...args),
}));

import { AccessRequestList } from "./AccessRequestList";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function buildItem(overrides: Partial<AccessRequestInboxListItem> = {}): AccessRequestInboxListItem {
  return {
    accessRequestId: "ar_1",
    name: "Tester One",
    email: "one@example.test",
    allianceName: null,
    message: "Let me in",
    createdAt: new Date("2026-07-20T12:00:00Z"),
    status: "PENDING",
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
    ...overrides,
  };
}

async function mount(items: AccessRequestInboxListItem[]) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(AccessRequestList, { items }));
  });
}

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFetchWaveOptions.mockResolvedValue({ success: true, waves: [] });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("AccessRequestList", () => {
  it("renders status, alliance, and 'No alliance' fallback for each item", async () => {
    await mount([
      buildItem({ accessRequestId: "ar_1", allianceName: "Alpha Alliance" }),
      buildItem({ accessRequestId: "ar_2", name: "Tester Two", email: "two@example.test", allianceName: null }),
    ]);

    expect(container.querySelector('[data-testid="access-request-card-ar_1"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="access-request-row-ar_1"]')).not.toBeNull();
    expect(container.textContent).toContain("Alpha Alliance");
    expect(container.textContent).toContain("—"); // "No alliance" fallback for ar_2
    expect(container.textContent).toContain("Pending");
  });

  it("does not mount an actions panel until the row is opened", async () => {
    await mount([buildItem()]);

    expect(container.querySelector('[data-testid="mock-panel-ar_1"]')).toBeNull();

    const toggle = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("data-testid") === "access-request-toggle-ar_1",
    );
    await act(async () => {
      toggle?.click();
    });

    expect(container.querySelector('[data-testid="mock-panel-ar_1"]')).not.toBeNull();
  });

  it("loads wave options exactly once and shares them across every open panel", async () => {
    mockFetchWaveOptions.mockResolvedValue({
      success: true,
      waves: [{ id: "Wave 1", name: "Wave 1" }],
    });

    await mount([buildItem({ accessRequestId: "ar_1" }), buildItem({ accessRequestId: "ar_2" })]);

    const toggles = Array.from(container.querySelectorAll("button")).filter((b) =>
      (b.getAttribute("data-testid") ?? "").startsWith("access-request-toggle-"),
    );
    expect(toggles).toHaveLength(4); // 2 items x (mobile card + desktop row)

    // toggles[0]/[1] are the mobile-card toggles for ar_1/ar_2 respectively
    // (cards render before the desktop table) — click both distinct items'
    // panels open in the same tick.
    await act(async () => {
      toggles[0]!.click();
      toggles[1]!.click();
    });
    await flush();

    expect(mockFetchWaveOptions).toHaveBeenCalledTimes(1);
    const panels = container.querySelectorAll('[data-testid^="mock-panel-"]');
    for (const panel of Array.from(panels)) {
      expect(panel.textContent).toBe("waveOptionsState:loaded:1");
    }
  });

  it("resets its loading guard and lets a later row retry when the fetch action rejects outright", async () => {
    // fetchBetaWaveOptionsAction rejects (rather than resolving with
    // { success: false }) when requirePlatformAdmin throws — e.g. an
    // expired session. Without resetting the loading guard on rejection,
    // every row's combobox would be stuck loading forever (review feedback
    // on PR #260).
    mockFetchWaveOptions.mockRejectedValueOnce(new Error("session expired"));

    await mount([buildItem({ accessRequestId: "ar_1" }), buildItem({ accessRequestId: "ar_2" })]);
    const toggles = Array.from(container.querySelectorAll("button")).filter((b) =>
      (b.getAttribute("data-testid") ?? "").startsWith("access-request-toggle-"),
    );

    await act(async () => {
      toggles[0]!.click(); // opens ar_1's panel, triggering the failing fetch
    });
    await flush();
    expect(mockFetchWaveOptions).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[data-testid="mock-panel-ar_1"]')?.textContent).toContain(
      "waveOptionsState:error",
    );

    mockFetchWaveOptions.mockResolvedValue({
      success: true,
      waves: [{ id: "Wave 1", name: "Wave 1" }],
    });
    await act(async () => {
      toggles[1]!.click(); // opens ar_2's panel — must retry, not stay stuck forever
    });
    await flush();

    expect(mockFetchWaveOptions).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="mock-panel-ar_2"]')?.textContent).toBe(
      "waveOptionsState:loaded:1",
    );
  });

  it("surfaces a resolved { success: false } as a retryable error, rather than caching it as an empty successful list forever", async () => {
    // Review feedback on PR #260: a resolved { success: false } (as opposed
    // to an outright rejection) was previously mapped straight to an empty
    // `waves: []` array — indistinguishable from "there are genuinely no
    // waves yet" and with no way to retry short of a full page refresh.
    mockFetchWaveOptions.mockResolvedValueOnce({ success: false, error: "Database unavailable" });

    await mount([buildItem({ accessRequestId: "ar_1" })]);
    const toggle = Array.from(container.querySelectorAll("button")).find(
      (b) => b.getAttribute("data-testid") === "access-request-toggle-ar_1",
    );
    await act(async () => {
      toggle?.click();
    });
    await flush();

    expect(container.querySelector('[data-testid="mock-panel-ar_1"]')?.textContent).toContain(
      "waveOptionsState:error",
    );

    mockFetchWaveOptions.mockResolvedValue({
      success: true,
      waves: [{ id: "Wave 1", name: "Wave 1" }],
    });
    const retry = container.querySelector<HTMLButtonElement>('[data-testid="mock-retry-ar_1"]');
    await act(async () => {
      retry?.click();
    });
    await flush();

    expect(mockFetchWaveOptions).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[data-testid="mock-panel-ar_1"]')?.textContent).toBe(
      "waveOptionsState:loaded:1",
    );
  });
});
