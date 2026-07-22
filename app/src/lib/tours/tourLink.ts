/**
 * Deep-link vocabulary for launching a tour from another page (e.g. Setup).
 *
 * A link like `/alliances/{id}/metrics?tour=configure-metrics` navigates to the
 * destination and lets a `TourAutoStart` client there resolve the tour by id and
 * run it. The tour teaches the task; it deliberately does NOT navigate the user
 * away when it finishes — they stay on the destination page, ready to act.
 *
 * These are pure string helpers with no client/runtime dependency so they are
 * usable from Server Components (building hrefs) and easy to unit-test.
 */

import { sanitizeInternalPath } from "@/app/src/lib/internalPath";

export const TOUR_QUERY_PARAM = "tour";

/**
 * Build a Setup -> destination deep-link that auto-starts `tourId`. Preserves any
 * query already on `destination` and encodes values safely (via URL/URLSearchParams).
 *
 * `destination` must be a same-origin path (it is our own href). Passing an
 * absolute/protocol-relative/scheme URL is a programming error and throws, since
 * it would otherwise produce a surprising relative href.
 */
export function buildTourHref({
  destination,
  tourId,
}: {
  destination: string;
  tourId: string;
}): string {
  const safeDestination = sanitizeInternalPath(destination);
  if (!safeDestination) {
    throw new Error(
      `buildTourHref: destination must be a same-origin path, received: ${destination}`
    );
  }

  const url = new URL(safeDestination, "http://localhost");
  url.searchParams.set(TOUR_QUERY_PARAM, tourId);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Given a location search string (e.g. `window.location.search`), remove only
 * the tour param and preserve everything else. Returns a search suffix with a
 * leading "?" or an empty string. Used to clean the address bar after a tour
 * auto-starts, so a refresh or Back doesn't retrigger it.
 */
export function stripTourParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(TOUR_QUERY_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
