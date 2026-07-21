"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  TOURS_BY_ID,
  TOUR_QUERY_PARAM,
  RETURN_TO_QUERY_PARAM,
  stripTourParams,
} from "@/app/src/lib/tours";
import { sanitizeInternalPath } from "@/app/src/lib/internalPath";
import { runTour } from "./runTour";

/**
 * Auto-starts a tour when the page is opened via a deep link like
 * `?tour={id}&returnTo={path}` (see `buildTourHref`). On completion, returns the
 * user to `returnTo`. Renders nothing.
 *
 * Lifecycle notes:
 * - The launch parameters are read ONCE, directly from `window.location`, inside
 *   the effect - deliberately NOT via `useSearchParams`. Native `replaceState`
 *   integrates with the App Router and updates `useSearchParams`; if the launch
 *   params were reactive effect dependencies, cleaning the URL below would flip
 *   `tourId` to null, re-run the effect's cleanup, and abort/destroy the very
 *   tour we just launched. A one-time snapshot breaks that feedback loop (and
 *   removes the need for a `<Suspense>` boundary).
 * - The address bar is cleaned (tour params removed, others preserved) via
 *   `history.replaceState` rather than a router navigation, so the underlying
 *   route does not re-render beneath the Driver.js overlay and a refresh/Back
 *   won't retrigger the tour. The existing history state object is preserved so
 *   App Router back/forward keeps working.
 * - An `AbortController` is aborted on unmount. If the effect is torn down
 *   before the lazy Driver.js import resolves, the aborted run never creates a
 *   Driver instance, so exactly one instance is ever created - no race over
 *   Driver's global DOM that could leave the tour broken/invisible.
 * - `onFinished` navigates only on real completion (see `runTour`).
 */
export function TourAutoStart() {
  const router = useRouter();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tourId = params.get(TOUR_QUERY_PARAM);
    const returnToParam = params.get(RETURN_TO_QUERY_PARAM);

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

    const safeReturnTo = sanitizeInternalPath(returnToParam);
    const controller = new AbortController();
    let destroy: (() => void) | undefined;

    void runTour(tour, {
      signal: controller.signal,
      onFinished: () => {
        if (safeReturnTo) {
          router.push(safeReturnTo);
        }
      },
    })
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
  }, [router]);

  return null;
}
