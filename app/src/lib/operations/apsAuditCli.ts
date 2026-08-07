/**
 * Pure CLI-argument parsing and target-identity gating for the APS
 * data-readiness audit CLI (#284 PR A).
 *
 * Deliberately split out of `scripts/audit-aps-data-readiness.ts` (the
 * entrypoint) and into `app/src/lib/operations/` so it can be unit-tested
 * under `npm run test:unit`/`test:ci` -- both invoke Vitest scoped to
 * `--dir app`, which never scans `scripts/`. Importing the entrypoint
 * script directly from a test file would also re-run its top-level
 * `main()` as an import side effect (a real DB connection attempt on every
 * test run); this module has no top-level side effects at all.
 */
import type { resolveBackfillTargetIdentity } from "./betaParticipantBackfillDb";

export function parseAuditArgs(argv: string[]): {
  allianceIds: string[];
  confirmIdentity: string | null;
} {
  let allianceIds: string[] = [];
  let confirmIdentity: string | null = null;

  for (const arg of argv) {
    if (arg.startsWith("--alliance-ids=")) {
      allianceIds = arg
        .slice("--alliance-ids=".length)
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean);
      continue;
    }
    const identityMatch = arg.match(/^--yes-i-am-sure-this-is-(.+)$/);
    if (identityMatch) {
      confirmIdentity = identityMatch[1]!;
    }
  }

  return { allianceIds, confirmIdentity };
}

const KNOWN_LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** True only for a hostname positively identified as local -- never inferred from the absence of production configuration. */
function isKnownLocalHostname(hostname: string): boolean {
  return KNOWN_LOCAL_HOSTNAMES.has(hostname.toLowerCase());
}

/**
 * Fails CLOSED: requires exact `--yes-i-am-sure-this-is-<identity>`
 * confirmation for every database target that is not positively identified
 * as local, not merely every target `resolveBackfillTargetIdentity` flags
 * `isProduction`.
 *
 * `isProduction` is derived from the `PRODUCTION_DB_HOSTS` allowlist (see
 * `productionDb.ts`): if that allowlist is unset, empty, or simply doesn't
 * list this particular database yet, `isProduction` silently reports
 * `false` -- even when `DATABASE_URL` points at a real remote/production
 * database. Gating this audit's confirmation requirement on "positively
 * local" instead means a missing or incomplete production allowlist can
 * only make this check MORE conservative (asking for a confirmation it
 * turned out not to strictly need), never less -- it can never silently
 * skip the guardrail the way gating on `isProduction` alone would.
 *
 * The thrown message is fully generic -- no identity, hostname, or
 * production classification -- because it reaches stderr/CI logs on every
 * accidental invocation against a non-local database, including ones an
 * operator never intended to run at all. It does not try to double as the
 * mechanism for discovering the confirmation string either: that lookup is
 * a wholly separate, minimal script (`scripts/show-aps-audit-target-identity.ts`)
 * that writes the identity to a local file instead of stdout/stderr, so it
 * never becomes something this audit CLI itself discloses as a side effect
 * of failing.
 */
export function assertAuditTargetIdentity(
  confirmIdentity: string | null,
  target: ReturnType<typeof resolveBackfillTargetIdentity>,
): void {
  if (isKnownLocalHostname(target.hostname)) return;

  if (confirmIdentity !== target.identity) {
    throw new Error(
      "Refusing to audit a non-local database: this requires an explicit --yes-i-am-sure-this-is-<identity> " +
        "confirmation bound to the exact target database. Run `npx tsx scripts/show-aps-audit-target-identity.ts` " +
        "(a separate, deliberate action that writes the identity to a local file, never to stdout/stderr) to look " +
        "up the identity string for the currently configured DATABASE_URL, then re-run with that confirmation " +
        "flag. Only a positively-identified local database (localhost/127.0.0.1) skips this confirmation -- an " +
        "unset or incomplete PRODUCTION_DB_HOSTS allowlist does NOT.",
    );
  }
}
