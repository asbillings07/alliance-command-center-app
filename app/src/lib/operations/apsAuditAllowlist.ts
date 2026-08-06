/**
 * Mandatory alliance-id allowlist enforcement for the APS data-readiness
 * audit (#284 PR A). The audit never defaults to "all alliances" — a
 * caller must supply an explicit, non-empty, duplicate-free list of
 * alliance ids, and every id must resolve to a real `Alliance` row inside
 * the same read-only transaction the rest of the audit runs in. Anything
 * else (empty list, duplicates, an id that doesn't resolve — whether
 * because it's simply wrong or because it belongs to a different scope
 * entirely) aborts the whole audit before any other query runs.
 */
import type { AuditTxClient } from "./apsAuditTransaction";

export class AllianceAllowlistError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllianceAllowlistError";
  }
}

function findDuplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) duplicates.add(id);
    seen.add(id);
  }
  return [...duplicates];
}

/**
 * Validates the caller-supplied allowlist and returns the resolved
 * alliance ids in the same read-only transaction — never the global
 * `prisma` client — so allowlist resolution is covered by the same
 * database-enforced read-only guarantee as every other audit query.
 */
export async function validateAllianceAllowlist(
  tx: AuditTxClient,
  allianceIds: readonly string[],
): Promise<string[]> {
  if (allianceIds.length === 0) {
    throw new AllianceAllowlistError(
      "Refusing to run: the alliance-id allowlist must be non-empty. This audit never defaults to auditing every alliance.",
    );
  }

  const duplicates = findDuplicates(allianceIds);
  if (duplicates.length > 0) {
    // Deliberately reports only the count, never the raw id(s): this error
    // can bubble to stderr/CI logs, and a raw alliance id is a real
    // database primary key an operator could use to look up or reference
    // the tenant directly -- the same disclosure-surface concern as the
    // unresolved-id branch below.
    throw new AllianceAllowlistError(
      `Refusing to run: ${duplicates.length} duplicate alliance id(s) in the allowlist. Confirm the exact, ` +
        "consented allowlist before retrying.",
    );
  }

  const resolved = await tx.alliance.findMany({
    where: { id: { in: [...allianceIds] } },
    select: { id: true },
  });
  const resolvedIds = new Set(resolved.map((row) => row.id));
  const unresolved = allianceIds.filter((id) => !resolvedIds.has(id));
  if (unresolved.length > 0) {
    throw new AllianceAllowlistError(
      `Refusing to run: ${unresolved.length} alliance id(s) in the allowlist did not resolve to a known alliance ` +
        "(unknown id, typo, or an id from a different scope). Confirm the exact, consented allowlist before retrying.",
    );
  }

  return [...resolvedIds];
}
