/**
 * Deep-link vocabulary for launching a tour from another page (e.g. Setup).
 *
 * A link like `/alliances/{id}/metrics?tour=configure-metrics&returnTo=/alliances/{id}/setup`
 * navigates to the destination and lets a `TourAutoStart` client there resolve
 * the tour by id, run it, and return the user to `returnTo` on completion.
 *
 * These are pure string helpers with no client/runtime dependency so they are
 * usable from Server Components (building hrefs) and easy to unit-test.
 */

export const TOUR_QUERY_PARAM = "tour";
export const RETURN_TO_QUERY_PARAM = "returnTo";

/**
 * Build a Setup -> destination deep-link that auto-starts `tourId` and returns
 * to `returnTo` when finished. Preserves any query already on `destination` and
 * encodes values safely (via URL/URLSearchParams).
 */
export function buildTourHref({
  destination,
  tourId,
  returnTo,
}: {
  destination: string;
  tourId: string;
  returnTo: string;
}): string {
  const url = new URL(destination, "http://localhost");
  url.searchParams.set(TOUR_QUERY_PARAM, tourId);
  url.searchParams.set(RETURN_TO_QUERY_PARAM, returnTo);
  return `${url.pathname}${url.search}${url.hash}`;
}

/**
 * Given a location search string (e.g. `window.location.search`), remove only
 * the tour params and preserve everything else. Returns a search suffix with a
 * leading "?" or an empty string. Used to clean the address bar after a tour
 * auto-starts, so a refresh or Back doesn't retrigger it.
 */
export function stripTourParams(search: string): string {
  const params = new URLSearchParams(search);
  params.delete(TOUR_QUERY_PARAM);
  params.delete(RETURN_TO_QUERY_PARAM);
  const rest = params.toString();
  return rest ? `?${rest}` : "";
}
