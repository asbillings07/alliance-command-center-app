/**
 * Operator-local, non-loggable target-identity lookup for the APS audit CLI
 * (#284 PR A) -- see `audit-aps-data-readiness.ts`'s module doc comment for
 * the safety contract this supports.
 *
 * This is a deliberately SEPARATE, minimal script -- not a flag on the
 * audit CLI itself -- so the audit CLI's own stdout/stderr can never carry
 * a database identity under any invocation, including an accidental one.
 * This script:
 *   - Imports nothing beyond `dotenv/config`, `apsAuditIdentityLookup.ts`
 *     (itself importing only `productionDb.ts`, which has zero imports),
 *     and `apsAuditIdentityFileWriter.ts` (Node builtins only: `fs`/`os`/
 *     `path`/`crypto`). It can never construct or connect a Prisma client
 *     -- by construction of its import graph, not by convention -- so
 *     resolving an identity here never touches a database at all,
 *     reachable or not.
 *   - Writes the identity to a local file (mode 0600, current user only,
 *     exclusively created -- see `apsAuditIdentityFileWriter.ts` for why
 *     that matters on a shared temp directory) under the OS temp
 *     directory, never to stdout/stderr, so it can't end up in shell
 *     history, CI logs, or a captured terminal transcript.
 *   - Prints only the file's path -- never the identity itself.
 *
 * Usage:
 *   npx tsx scripts/show-aps-audit-target-identity.ts
 *   cat <path printed above>   # read locally -- never paste into logs/CI/chat
 *   rm <path printed above>    # clean up when done
 */
import "dotenv/config";
import { resolveApsAuditTargetIdentity } from "../app/src/lib/operations/apsAuditIdentityLookup";
import { writeIdentityToLocalFile } from "../app/src/lib/operations/apsAuditIdentityFileWriter";

function main(): void {
  const identity = resolveApsAuditTargetIdentity();
  const path = writeIdentityToLocalFile(identity);

  // Deliberately the ONLY output this script ever produces -- the file
  // path, never the identity itself. See the module doc comment.
  console.log(`Target identity written to a local file (not printed here): ${path}`);
  console.log("Read it locally to build --yes-i-am-sure-this-is-<identity>, then delete the file.");
}

main();
