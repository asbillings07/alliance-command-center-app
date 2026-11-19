/** @vitest-environment jsdom */
import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RankingScreenshotDialog } from "./RankingScreenshotDialog";
import { installDialogPolyfill } from "@/app/src/lib/testing/dialogPolyfill";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  installDialogPolyfill();
  // Native close events are queued, not dispatched synchronously by close().
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    if (!this.open) return;
    this.open = false;
    setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  });
  container = document.createElement("div"); document.body.appendChild(container);
  root = createRoot(container); document.body.style.overflow = "scroll";
});
afterEach(async () => {
  await act(async () => { root.unmount(); await vi.runAllTimersAsync(); });
  container.remove(); document.body.style.overflow = ""; vi.restoreAllMocks(); vi.useRealTimers();
});

describe("ranking source preview lifecycle", () => {
  it("wraps keyboard focus at both boundaries while the image loads or is unavailable", async () => {
    await act(async () => root.render(createElement(RankingScreenshotDialog, {
      imageUrl: "/private-synthetic-image", title: "Screenshot 1", periodLabel: "Monday",
      uploadedBy: "Synthetic leader", uploadedAt: "2026-11-18T12:00:00Z", onClose: vi.fn(),
    })));
    const close = container.querySelector("button")!;
    const imageRegion = container.querySelector<HTMLElement>('[role="region"]')!;
    for (const unavailable of [false, true]) {
      if (unavailable) await act(async () => { container.querySelector("img")!.dispatchEvent(new Event("error")); });
      close.focus();
      const reverseTab = new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true });
      await act(async () => { close.dispatchEvent(reverseTab); });
      expect(reverseTab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(imageRegion);
      const forwardTab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
      await act(async () => { imageRegion.dispatchEvent(forwardTab); });
      expect(forwardTab.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(close);
    }
  });

  it.each(["Escape", "Close preview"])("stays open in Strict Mode and dismisses with %s without losing scroll state", async closeWith => {
    const closed = vi.fn();
    function Review() {
      const [open, setOpen] = useState(false);
      return createElement("div", null,
        createElement("button", { onClick: () => setOpen(true) }, "View screenshot"),
        open && createElement(RankingScreenshotDialog, {
          imageUrl: "/private-synthetic-image", title: "Screenshot 1", periodLabel: "Monday",
          uploadedBy: "Synthetic leader", uploadedAt: "2026-11-18T12:00:00Z",
          onClose: () => { closed(); setOpen(false); },
        }));
    }
    await act(async () => root.render(createElement(StrictMode, null, createElement(Review))));
    for (let cycle = 0; cycle < 2; cycle++) {
      await act(async () => { container.querySelector("button")!.click(); });
      await act(async () => { await vi.runAllTimersAsync(); });
      const dialog = container.querySelector("dialog")!;
      expect(dialog?.open).toBe(true); expect(closed).toHaveBeenCalledTimes(cycle);
      expect(document.body.style.overflow).toBe("hidden");
      await act(async () => {
        if (closeWith === "Escape") {
          const cancel = new Event("cancel", { cancelable: true }); dialog.dispatchEvent(cancel);
          if (!cancel.defaultPrevented) dialog.close();
        } else {
          Array.from(dialog.querySelectorAll("button")).find(b => b.textContent === "Close preview")!.click();
        }
        await vi.runAllTimersAsync();
      });
      expect(container.querySelector("dialog")).toBeNull();
      expect(closed).toHaveBeenCalledTimes(cycle + 1);
      expect(document.body.style.overflow).toBe("scroll");
    }
  });
});
