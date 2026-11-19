/** @vitest-environment jsdom */
import { act, createElement, StrictMode, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AllianceBatchDialog } from "./AllianceBatchDialog";
import { installDialogPolyfill } from "@/app/src/lib/testing/dialogPolyfill";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let container: HTMLDivElement; let root: Root;
beforeEach(() => {
  vi.useFakeTimers(); installDialogPolyfill();
  vi.spyOn(HTMLDialogElement.prototype, "showModal").mockImplementation(function (this: HTMLDialogElement) { this.open = true; });
  vi.spyOn(HTMLDialogElement.prototype, "close").mockImplementation(function (this: HTMLDialogElement) {
    if (!this.open) return; this.open = false; setTimeout(() => this.dispatchEvent(new Event("close")), 0);
  });
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  document.body.style.overflow = "scroll";
});
afterEach(async () => {
  await act(async () => { root.unmount(); await vi.runAllTimersAsync(); });
  container.remove(); document.body.style.overflow = ""; vi.restoreAllMocks(); vi.useRealTimers();
});
describe("alliance rejection notice", () => {
  it.each(["Escape", "Back to screenshots"])("dismisses with %s, preserves warnings and contains keyboard focus", async action => {
    const closed = vi.fn();
    function Review() {
      const [open, setOpen] = useState(true);
      return createElement("div", null, createElement("p", null, "Screenshot 1: wrong alliance"),
        open && createElement(AllianceBatchDialog, { count: 2, allForeign: true, allianceName: "Synthetic", server: "956", onClose: () => { closed(); setOpen(false); } }));
    }
    await act(async () => { root.render(createElement(StrictMode, null, createElement(Review))); await vi.runAllTimersAsync(); });
    const dialog = container.querySelector("dialog")!; const button = dialog.querySelector("button")!;
    expect(dialog.open).toBe(true); expect(document.body.style.overflow).toBe("hidden");
    expect(dialog.textContent).toContain("None of the 2 selected screenshots match");
    for (const shiftKey of [false, true]) {
      button.focus(); const tab = new KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      await act(async () => { button.dispatchEvent(tab); });
      expect(tab.defaultPrevented).toBe(true); expect(document.activeElement).toBe(button);
    }
    await act(async () => {
      if (action === "Escape") { const event = new Event("cancel", { cancelable: true }); dialog.dispatchEvent(event); if (!event.defaultPrevented) dialog.close(); }
      else button.click();
      await vi.runAllTimersAsync();
    });
    expect(closed).toHaveBeenCalledTimes(1); expect(container.querySelector("dialog")).toBeNull();
    expect(container.textContent).toContain("Screenshot 1: wrong alliance"); expect(document.body.style.overflow).toBe("scroll");
  });
  it("does not call unreadable evidence another alliance", async () => {
    await act(async () => root.render(createElement(AllianceBatchDialog, { count: 2, allForeign: false, allianceName: "Synthetic", server: "956", onClose: vi.fn() })));
    expect(container.textContent).toContain("No screenshots could be verified");
    expect(container.textContent).not.toContain("None of the 2 selected screenshots match");
  });
});
