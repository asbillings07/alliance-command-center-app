"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
 * Because it reads search params, it must be mounted inside a `<Suspense>`
 * boundary (required by `useSearchParams`).
 *
 * Lifecycle notes:
 * - The address bar is cleaned (tour params removed, others preserved) via
 *   `history.replaceState` rather than a router navigation, so the underlying
 *   route does not re-render beneath the Driver.js overlay and a refresh/Back
 *   won't retrigger the tour.
 * - An `AbortController` is aborted on cleanup. If the effect is torn down
 *   before the lazy Driver.js import resolves (notably React StrictMode's
 *   mount -> unmount -> mount in dev), the aborted run never creates a Driver
 *   instance, so exactly one instance is ever created - no race over Driver's
 *   global DOM that could leave the tour broken/invisible.
 * - `onFinished` navigates only on real completion (see `runTour`).
 */
export function TourAutoStart() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const tourId = searchParams.get(TOUR_QUERY_PARAM);
  const returnToParam = searchParams.get(RETURN_TO_QUERY_PARAM);

  useEffect(() => {
    if (!tourId) {
      return;
    }

    // Clean the address bar first so a refresh/Back won't retrigger the tour,
    // preserving any unrelated query params.
    const cleanUrl =
      window.location.pathname +
      stripTourParams(window.location.search) +
      window.location.hash;
    window.history.replaceState(null, "", cleanUrl);

    const tour = TOURS_BY_ID.get(tourId);
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
    }).then((teardown) => {
      destroy = teardown;
      // Unmounted between import start and resolve: tear the tour down now.
      if (controller.signal.aborted) {
        teardown();
      }
    });

    return () => {
      controller.abort();
      destroy?.();
    };
  }, [tourId, returnToParam, router]);

  return null;
}
