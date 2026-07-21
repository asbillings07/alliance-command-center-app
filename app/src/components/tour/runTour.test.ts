import { describe, it, expect, vi, beforeEach } from "vitest";
import type { TourDefinition } from "@/app/src/lib/tours/types";

// Capture the config passed to Driver.js and simulate its lifecycle so we can
// assert runTour's completion semantics without a browser/DOM.
const h = vi.hoisted(() => ({
  config: null as Record<string, unknown> | null,
  driveCount: 0,
  rawDestroyCalls: 0,
}));

vi.mock("driver.js", () => ({
  driver: (config: Record<string, unknown>) => {
    h.config = config;
    let destroyed = false;
    return {
      drive: () => {
        h.driveCount++;
      },
      destroy: () => {
        h.rawDestroyCalls++;
        if (destroyed) return;
        destroyed = true;
        (config.onDestroyed as (() => void) | undefined)?.();
      },
    };
  },
}));

import { runTour } from "./runTour";

const twoStep: TourDefinition = {
  id: "two-step",
  steps: [
    { element: "#a", title: "A", description: "a" },
    { element: "#b", title: "B", description: "b" },
  ],
};

const oneStep: TourDefinition = {
  id: "one-step",
  steps: [{ element: "#a", title: "A", description: "a" }],
};

function onDoneClick() {
  (h.config?.onDoneClick as (() => void) | undefined)?.();
}
function onDestroyed() {
  (h.config?.onDestroyed as (() => void) | undefined)?.();
}

beforeEach(() => {
  h.config = null;
  h.driveCount = 0;
  h.rawDestroyCalls = 0;
});

describe("runTour", () => {
  it("drives the tour once and maps steps to popovers", async () => {
    await runTour(twoStep);

    expect(h.driveCount).toBe(1);
    const steps = h.config?.steps as Array<{
      element?: string;
      popover: { title: string; description: string };
    }>;
    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({
      element: "#a",
      popover: { title: "A", description: "a" },
    });
  });

  it("shows progress only when there is more than one step", async () => {
    await runTour(twoStep);
    expect(h.config?.showProgress).toBe(true);

    await runTour(oneStep);
    expect(h.config?.showProgress).toBe(false);
  });

  it("calls onFinished when the user clicks Done", async () => {
    const onFinished = vi.fn();
    await runTour(twoStep, { onFinished });

    onDoneClick();

    expect(onFinished).toHaveBeenCalledTimes(1);
  });

  it("does not call onFinished when the tour is closed (external destroy)", async () => {
    const onFinished = vi.fn();
    await runTour(twoStep, { onFinished });

    // The X button, backdrop click, and Escape all funnel through destroy ->
    // onDestroyed without ever hitting onDoneClick.
    onDestroyed();

    expect(onFinished).not.toHaveBeenCalled();
  });

  it("does not call onFinished when torn down via the returned handle", async () => {
    const onFinished = vi.fn();
    const destroy = await runTour(twoStep, { onFinished });

    destroy();

    expect(h.rawDestroyCalls).toBeGreaterThan(0);
    expect(onFinished).not.toHaveBeenCalled();
  });

  it("never creates a Driver instance when aborted before it starts", async () => {
    const controller = new AbortController();
    controller.abort();

    const destroy = await runTour(twoStep, { signal: controller.signal });

    // No driver was configured or driven, and the returned handle is a no-op.
    expect(h.config).toBeNull();
    expect(h.driveCount).toBe(0);
    expect(() => destroy()).not.toThrow();
    expect(h.rawDestroyCalls).toBe(0);
  });

  it("is safe to tear down after completion (no double onFinished)", async () => {
    const onFinished = vi.fn();
    const destroy = await runTour(twoStep, { onFinished });

    onDoneClick();
    expect(onFinished).toHaveBeenCalledTimes(1);

    destroy();
    expect(onFinished).toHaveBeenCalledTimes(1);
  });
});
