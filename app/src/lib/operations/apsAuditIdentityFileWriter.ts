/**
 * Secure, exclusive-create local file write for the APS audit's
 * operator-local identity lookup (#284 PR A review: symlink/race
 * hardening on `scripts/show-aps-audit-target-identity.ts`).
 *
 * Deliberately a SEPARATE module from `apsAuditIdentityLookup.ts` so that
 * module's "imports nothing beyond productionDb.ts" contract stays exact.
 * This module imports only Node builtins (`fs`/`os`/`path`/`crypto`) --
 * never a database-related module, so it's equally safe for the identity
 * script to depend on.
 *
 * Writes with `O_CREAT | O_EXCL` (the `"wx"` flag): if anything already
 * exists at the generated path -- a regular file, a symlink planted by
 * another user on a shared, world-writable temp directory, a hardlink, a
 * FIFO -- the write FAILS instead of following or overwriting it. A
 * predictable filename plus a non-exclusive write is a classic local
 * symlink attack: an attacker who predicts (or sprays) the path plants a
 * symlink to a file they want overwritten or exfiltrated through, and a
 * naive `writeFileSync` would silently follow it. `wx` makes existence-
 * check-and-create a single atomic kernel operation, so there is no
 * window for a symlink to be substituted afterward, and an existing
 * symlink at the path is itself treated as "the path exists" -- it is
 * never followed, dereferenced, or overwritten.
 *
 * 128 bits of randomness (not a smaller value) makes the filename
 * infeasible to predict or spray even for a motivated local attacker, so
 * in practice the `wx` failure path should only ever trigger on a
 * genuine (and vanishingly unlikely) collision -- but the two defenses
 * matter together, not as substitutes for each other.
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type WriteIdentityOptions = {
  /** Overrides the OS temp directory -- for tests only. */
  tmpDir?: string;
  /** Overrides the random filename suffix -- for tests only, to force a deterministic (colliding) path. */
  randomSuffix?: string;
};

/**
 * Writes `identity` to a new, exclusively-created, mode-0600 file under
 * the temp directory and returns its path. Throws (via `writeFileSync`'s
 * `EEXIST`) rather than following or overwriting anything already at the
 * computed path.
 */
export function writeIdentityToLocalFile(identity: string, options: WriteIdentityOptions = {}): string {
  const dir = options.tmpDir ?? tmpdir();
  const suffix = options.randomSuffix ?? randomBytes(16).toString("hex");
  const path = join(dir, `aps-audit-target-identity-${suffix}.local`);
  writeFileSync(path, `${identity}\n`, { mode: 0o600, flag: "wx" });
  return path;
}
