/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// Isolate the component from Driver.js: assert on the runner contract only.
const runTour = vi.hoisted(() => vi.fn());
vi.mock("./runTour", () => ({ runTour }));

import { TourAutoStart } from "./TourAutoStart";
import { CREATE_PERIOD_TOUR_ID, createPeriodTour } from "@/app/src/lib/tours";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const PERIODS = "/alliances/a1/periods";

let container: HTMLDivElement;
let root: Root;

function setLocation(search: string) {
  window.history.replaceState({ __NA: "seed" }, "", PERIODS + search);
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(TourAutoStart));
  });
  // Flush the runTour().then(...) microtask when it resolves synchronously.
  await act(async () => {});
}

// Unmount just the component (render null) so effect cleanup runs while the
// root stays intact; the root itself is torn down in afterEach.
async function unmountComponent() {
  await act(async () => {
    root.render(null);
  });
}

beforeEach(() => {
  runTour.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("TourAutoStart", () => {
  it("does nothing when there is no tour param", async () => {
    runTour.mockResolvedValue(vi.fn());
    setLocation("?foo=1");

    await mount();

    expect(runTour).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?foo=1");
  });

  it("starts the tour once, cleaning the URL while preserving other params and history state", async () => {
    const teardown = vi.fn();
    runTour.mockResolvedValue(teardown);
    setLocation(`?tour=${CREATE_PERIOD_TOUR_ID}&foo=1`);

    await mount();

    expect(runTour).toHaveBeenCalledTimes(1);
    const [tourArg, opts] = runTour.mock.calls[0];
    expect(tourArg.id).toBe(CREATE_PERIOD_TOUR_ID);
    expect(opts.signal.aborted).toBe(false);

    // URL cleaned: tour param removed, unrelated params + history state kept.
    expect(window.location.pathname).toBe(PERIODS);
    expect(window.location.search).toBe("?foo=1");
    expect(window.history.state).toEqual({ __NA: "seed" });

    expect(teardown).not.toHaveBeenCalled();
  });

  it("shows the completion banner in place when the tour finishes, without navigating", async () => {
    runTour.mockResolvedValue(vi.fn());
    setLocation(`?tour=${CREATE_PERIOD_TOUR_ID}`);

    await mount();

    // No banner before the user completes the tour.
    expect(container.querySelector('[role="status"]')).toBeNull();

    const opts = runTour.mock.calls[0][1];
    expect(typeof opts.onFinished).toBe("function");

    // Positive completion surfaces the handoff copy in place — the tour teaches
    // the task and hands off to the on-page action; it never navigates away.
    await act(async () => {
      opts.onFinished();
    });

    const banner = container.querySelector('[role="status"]');
    expect(banner?.textContent).toContain(createPeriodTour.completionMessage);
    expect(window.location.pathname).toBe(PERIODS);
    expect(window.location.search).toBe("");
  });

  it("lets the user dismiss the completion banner", async () => {
    runTour.mockResolvedValue(vi.fn());
    setLocation(`?tour=${CREATE_PERIOD_TOUR_ID}`);

    await mount();
    const opts = runTour.mock.calls[0][1];
    await act(async () => {
      opts.onFinished();
    });
    expect(container.querySelector('[role="status"]')).not.toBeNull();

    const dismiss = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Dismiss"]'
    );
    await act(async () => {
      dismiss?.click();
    });

    expect(container.querySelector('[role="status"]')).toBeNull();
  });

  it("does not abort or destroy the active tour when the URL is cleaned or the component re-renders", async () => {
    const teardown = vi.fn();
    runTour.mockResolvedValue(teardown);
    setLocation(`?tour=${CREATE_PERIOD_TOUR_ID}`);

    await mount();
    const opts = runTour.mock.calls[0][1];

    // A re-render (as a search-param sync would cause) must not re-run the
    // launch effect: it is a mount-only effect.
    await act(async () => {
      root.render(createElement(TourAutoStart));
    });
    await act(async () => {});

    expect(runTour).toHaveBeenCalledTimes(1);
    expect(opts.signal.aborted).toBe(false);
    expect(teardown).not.toHaveBeenCalled();
  });

  it("cleans the URL but does not run an unknown tour id", async () => {
    runTour.mockResolvedValue(vi.fn());
    setLocation("?tour=not-a-real-tour");

    await mount();

    expect(runTour).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  it("aborts and tears down if unmounted before the tour import resolves", async () => {
    const teardown = vi.fn();
    let resolveRun: () => void = () => {};
    runTour.mockReturnValue(
      new Promise<() => void>((resolve) => {
        resolveRun = () => resolve(teardown);
      })
    );
    setLocation(`?tour=${CREATE_PERIOD_TOUR_ID}`);

    await mount();
    const opts = runTour.mock.calls[0][1];

    await unmountComponent();
    expect(opts.signal.aborted).toBe(true);

    // The lazy import resolves only after unmount: tear the tour down.
    await act(async () => {
      resolveRun();
    });

    expect(teardown).toHaveBeenCalledTimes(1);
  });
});
