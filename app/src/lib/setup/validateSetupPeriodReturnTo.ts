/**
 * Validates the period-configuration continuation target for setup workflows.
 * Only `/alliances/{allianceId}/periods/{periodId}` for the current alliance is honored.
 */
export function validateSetupPeriodReturnTo(
  returnTo: string | undefined | null,
  allianceId: string,
): string | null {
  if (!returnTo) {
    return null;
  }

  const expectedPrefix = `/alliances/${allianceId}/periods/`;
  if (!returnTo.startsWith(expectedPrefix)) {
    return null;
  }

  const periodId = returnTo.slice(expectedPrefix.length);
  if (!periodId || periodId.includes("/")) {
    return null;
  }

  return returnTo;
}
