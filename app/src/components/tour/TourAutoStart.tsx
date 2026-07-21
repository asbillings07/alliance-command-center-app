"use client";

import { useEffect } from "react";
import {
  TOURS_BY_ID,
  TOUR_QUERY_PARAM,
  stripTourParams,
} from "@/app/src/lib/tours";
import { runTour } from "./runTour";

/**
 * Auto-starts a tour when the page is opened via a deep link like `?tour={id}`
 * (see `buildTourHref`). Renders nothing.
 *
 * The tour teaches the task; it does NOT perform it. So when the tour finishes
 * (or the user dismisses it), we deliberately leave the user on the destination
 * page — ready to create the metric/period or import members — rather than
 * navigating them anywhere. There is no return-path handling.
 *
 * Lifecycle notes:
 * - The launch parameter is read ONCE, directly from `window.location`, inside a
 *   mount-only effect - deliberately NOT via `useSearchParams`. Native
 *   `replaceState` integrates with the App Router and updates `useSearchParams`;
 *   if the launch param were a reactive effect dependency, cleaning the URL below
 *   would flip `tourId` to null, re-run the effect's cleanup, and abort/destroy
 *   the very tour we just launched. A one-time snapshot breaks that feedback loop
 *   (and removes the need for a `<Suspense>` boundary).
 * - The address bar is cleaned (tour param removed, others preserved) via
 *   `history.replaceState` rather than a router navigation, so the underlying
 *   route does not re-render beneath the Driver.js overlay and a refresh/Back
 *   won't retrigger the tour. The existing history state object is preserved so
 *   App Router back/forward keeps working.
 * - An `AbortController` is aborted on unmount. If the effect is torn down before
 *   the lazy Driver.js import resolves, the aborted run never creates a Driver
 *   instance, so exactly one instance is ever created - no race over Driver's
 *   global DOM that could leave the tour broken/invisible.
 */
export function TourAutoStart() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tourId = params.get(TOUR_QUERY_PARAM);

    if (!tourId) {
      return;
    }

    const tour = TOURS_BY_ID.get(tourId);

    // Clean the address bar first so a refresh/Back won't retrigger the tour,
    // preserving any unrelated query params and the App Router's history state.
    const cleanUrl =
      window.location.pathname +
      stripTourParams(window.location.search) +
      window.location.hash;
    window.history.replaceState(window.history.state, "", cleanUrl);

    if (!tour) {
      // Unknown id: URL is already cleaned; nothing to run.
      return;
    }

    const controller = new AbortController();
    let destroy: (() => void) | undefined;

    void runTour(tour, { signal: controller.signal })
      .then((teardown) => {
        destroy = teardown;
        // Unmounted between import start and resolve: tear the tour down now.
        if (controller.signal.aborted) {
          teardown();
        }
      })
      .catch(() => {
        // The lazy driver.js import failed (offline, chunk load error). A tour
        // is a non-critical enhancement, so swallow it rather than surface an
        // unhandled rejection.
      });

    return () => {
      controller.abort();
      destroy?.();
    };
  }, []);

  return null;
}
