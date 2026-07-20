/**
 * Pure session-version validation rule.
 *
 * Kept in its own dependency-free module (no Prisma, no env) so it can be
 * unit-tested in isolation and imported anywhere without pulling in the
 * database-backed session service.
 */

/**
 * Decide whether a token's session version should continue to be honored,
 * given the current database version.
 *
 * Tokens minted before this feature existed carry no version; treat `undefined`
 * as 0 to match the column default, so existing sessions are NOT force-logged
 * out on the deploy that introduces `sessionVersion`.
 */
export function validateSessionVersion(
  tokenVersion: number | undefined,
  dbVersion: number
): boolean {
  return (tokenVersion ?? 0) === dbVersion;
}
