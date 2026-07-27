/**
 * Validates the member-import continuation target for guided setup.
 * Only the exact literal `/alliances/{allianceId}/setup/import` is honored.
 */
export function validateSetupImportReturnTo(
  returnTo: string | undefined | null,
  allianceId: string,
): string | null {
  const expected = `/alliances/${allianceId}/setup/import`;
  if (returnTo === expected) {
    return returnTo;
  }
  return null;
}
