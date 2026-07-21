/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

// A stable router object, mirroring Next's real useRouter (whose identity is
// stable across renders). This matters: TourAutoStart depends on [router], so an
// unstable identity would re-run the launch effect on every render.
const push = vi.hoisted(() => vi.fn());
const router = vi.hoisted(() => ({ push }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));

// Isolate the component from Driver.js: assert on the runner contract only.
const runTour = vi.hoisted(() => vi.fn());
vi.mock("./runTour", () => ({ runTour }));

import { TourAutoStart } from "./TourAutoStart";
import { CREATE_PERIOD_TOUR_ID } from "@/app/src/lib/tours";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const PERIODS = "/alliances/a1/periods";
const RETURN_TO = "/alliances/a1/setup";

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

async function unmount() {
  await act(async () => {
    root.unmount();
  });
}

beforeEach(() => {
  push.mockReset();
  runTour.mockReset();
});

afterEach(() => {
  container?.remove();
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
    setLocation(
      `?tour=${CREATE_PERIOD_TOUR_ID}&returnTo=${encodeURIComponent(RETURN_TO)}&foo=1`
    );

    await mount();

    expect(runTour).toHaveBeenCalledTimes(1);
    const [tourArg, opts] = runTour.mock.calls[0];
    expect(tourArg.id).toBe(CREATE_PERIOD_TOUR_ID);
    expect(opts.signal.aborted).toBe(false);

    // URL cleaned: tour params removed, unrelated params + history state kept.
    expect(window.location.pathname).toBe(PERIODS);
    expect(window.location.search).toBe("?foo=1");
    expect(window.history.state).toEqual({ __NA: "seed" });

    expect(teardown).not.toHaveBeenCalled();
    expect(push).not.toHaveBeenCalled();
  });

  it("does not abort or destroy the active tour when the URL is cleaned or the component re-renders", async () => {
    const teardown = vi.fn();
    runTour.mockResolvedValue(teardown);
    setLocation(`?tour=${CREATE_PERIOD_TOUR_ID}&returnTo=${encodeURIComponent(RETURN_TO)}`);

    await mount();
    const opts = runTour.mock.calls[0][1];

    // A re-render (as a search-param sync would cause) must not re-run the
    // launch effect: its only dependency is the stable router.
    await act(async () => {
      root.render(createElement(TourAutoStart));
    });
    await act(async () => {});

    expect(runTour).toHaveBeenCalledTimes(1);
    expect(opts.signal.aborted).toBe(false);
    expect(teardown).not.toHaveBeenCalled();
  });

  it("navigates to the sanitized returnTo on completion", async () => {
    runTour.mockResolvedValue(vi.fn());
    setLocation(`?tour=${CREATE_PERIOD_TOUR_ID}&returnTo=${encodeURIComponent(RETURN_TO)}`);

    await mount();
    const opts = runTour.mock.calls[0][1];
    opts.onFinished();

    expect(push).toHaveBeenCalledWith(RETURN_TO);
  });

  it("does not navigate when the tour is not completed", async () => {
    runTour.mockResolvedValue(vi.fn());
    setLocation(`?tour=${CREATE_PERIOD_TOUR_ID}&returnTo=${encodeURIComponent(RETURN_TO)}`);

    await mount();

    // onFinished is never called for X / backdrop / Escape (see runTour).
    expect(push).not.toHaveBeenCalled();
  });

  it("cleans the URL but does not run an unknown tour id", async () => {
    runTour.mockResolvedValue(vi.fn());
    setLocation(`?tour=not-a-real-tour&returnTo=${encodeURIComponent(RETURN_TO)}`);

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
    setLocation(`?tour=${CREATE_PERIOD_TOUR_ID}&returnTo=${encodeURIComponent(RETURN_TO)}`);

    await mount();
    const opts = runTour.mock.calls[0][1];

    await unmount();
    expect(opts.signal.aborted).toBe(true);

    // The lazy import resolves only after unmount: tear the tour down, no nav.
    await act(async () => {
      resolveRun();
    });

    expect(teardown).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
  });
});
