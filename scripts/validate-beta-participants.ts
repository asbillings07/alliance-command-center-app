/**
 * Validate beta participant invariants before Deployment B / PR 1c (#174).
 *
 * MANUAL OPERATIONS SEQUENCE (do not skip):
 *   1. Deploy PR 1a (expand + dual-write).
 *   2. Deploy PR 1b (this script + backfill script — no migration).
 *   3. Run `npm run beta:backfill-participants -- --execute ...` in production.
 *   4. Run THIS script in production — all four checks must return zero rows.
 *   5. ONLY THEN merge/deploy PR 1c (contract migration).
 *
 * Exit code 0 = safe to apply PR 1c contract migration. Non-zero = halt rollout.
 *
 * Usage:
 *   npm run beta:validate-participants
 *   npm run beta:validate-participants -- --yes-i-am-sure-this-is-<db-identity>
 */

import "dotenv/config";
import { prisma } from "../app/src/lib/prisma";
import { resolveBackfillTargetIdentity } from "../app/src/lib/operations/betaParticipantBackfillDb";
import {
  formatValidationReport,
  runAllBetaParticipantValidationChecks,
} from "../app/src/lib/operations/betaParticipantValidation";

export function parseValidateArgs(argv: string[]): {
  confirmIdentity: string | null;
} {
  let confirmIdentity: string | null = null;
  for (const arg of argv) {
    const match = arg.match(/^--yes-i-am-sure-this-is-(.+)$/);
    if (match) {
      confirmIdentity = match[1]!;
    }
  }
  return { confirmIdentity };
}

export function assertValidationTargetIdentity(
  confirmIdentity: string | null,
  target: ReturnType<typeof resolveBackfillTargetIdentity>,
): void {
  console.log(
    `Validation target database identity: ${target.identity} (host: ${target.hostname})${target.isProduction ? " — PRODUCTION" : ""}`,
  );
  if (confirmIdentity !== target.identity) {
    throw new Error(
      `Refusing to validate: pass --yes-i-am-sure-this-is-${target.identity} (exact database identity) so this evidence is bound to the approved database.`,
    );
  }
}

async function main(): Promise<void> {
  const args = parseValidateArgs(process.argv.slice(2));
  const target = resolveBackfillTargetIdentity();
  assertValidationTargetIdentity(args.confirmIdentity, target);

  const results = await runAllBetaParticipantValidationChecks(prisma);
  console.log(formatValidationReport(results));
  console.log(
    `\nValidation database identity: ${target.identity}${target.isProduction ? " (PRODUCTION)" : ""}`,
  );

  const failing = results.filter((result) => result.rows.length > 0);
  if (failing.length > 0) {
    process.exitCode = 1;
  }
}

main()
  .catch((error) => {
    console.error(
      "\nValidation failed:",
      error instanceof Error ? error.message : error,
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
