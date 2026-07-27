export function buildMetricsLibraryHref(
  allianceId: string,
  periodId: string,
): string {
  const returnTo = `/alliances/${allianceId}/periods/${periodId}`;
  return `/alliances/${allianceId}/metrics?returnTo=${encodeURIComponent(returnTo)}`;
}
