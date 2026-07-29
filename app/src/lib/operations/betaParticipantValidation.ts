/**
 * Beta participant migration validation (#174 PR 1b).
 *
 * Four exhaustive checks that must all return zero rows before Deployment B's
 * contract migration runs. Used by `scripts/validate-beta-participants.ts` and
 * the contract migration pre-flight guard.
 */

import type { PrismaClient } from "@/app/generated/prisma/client";

export type BetaParticipantValidationCheck =
  | "null_participant_id"
  | "unflagged_multi_user"
  | "colliding_user_id"
  | "orphaned_participant";

export type BetaParticipantValidationRow = Record<string, unknown>;

export type BetaParticipantValidationResult = {
  check: BetaParticipantValidationCheck;
  label: string;
  rows: BetaParticipantValidationRow[];
};

export const BETA_PARTICIPANT_VALIDATION_CHECKS: Array<{
  check: BetaParticipantValidationCheck;
  label: string;
}> = [
  {
    check: "null_participant_id",
    label: "BetaInvitation rows with participantId IS NULL",
  },
  {
    check: "unflagged_multi_user",
    label:
      "BetaParticipant rows with identityAmbiguous=false but multiple distinct accepted userIds",
  },
  {
    check: "colliding_user_id",
    label: "BetaParticipant rows with colliding non-null userId values",
  },
  {
    check: "orphaned_participant",
    label: "BetaParticipant rows with zero associated BetaInvitation rows",
  },
];

export async function runBetaParticipantValidationCheck(
  prisma: PrismaClient,
  check: BetaParticipantValidationCheck,
): Promise<BetaParticipantValidationResult> {
  const meta = BETA_PARTICIPANT_VALIDATION_CHECKS.find(
    (entry) => entry.check === check,
  );
  if (!meta) {
    throw new Error(`Unknown validation check: ${check}`);
  }

  let rows: BetaParticipantValidationRow[] = [];

  switch (check) {
    case "null_participant_id":
      rows = await prisma.$queryRaw<BetaParticipantValidationRow[]>`
        SELECT id, email, "issuedAt"
        FROM "BetaInvitation"
        WHERE "participantId" IS NULL
        ORDER BY "issuedAt" ASC, id ASC
      `;
      break;
    case "unflagged_multi_user":
      rows = await prisma.$queryRaw<BetaParticipantValidationRow[]>`
        SELECT
          p.id AS "participantId",
          COUNT(DISTINCT bi."acceptedByUserId") AS "distinctAcceptedUserCount",
          ARRAY_AGG(DISTINCT bi."acceptedByUserId") AS "acceptedUserIds"
        FROM "BetaParticipant" p
        JOIN "BetaInvitation" bi ON bi."participantId" = p.id
        WHERE p."identityAmbiguous" = false
          AND bi."acceptedAt" IS NOT NULL
          AND bi."acceptedByUserId" IS NOT NULL
        GROUP BY p.id
        HAVING COUNT(DISTINCT bi."acceptedByUserId") > 1
        ORDER BY p.id ASC
      `;
      break;
    case "colliding_user_id":
      rows = await prisma.$queryRaw<BetaParticipantValidationRow[]>`
        SELECT
          "userId",
          COUNT(*)::int AS "participantCount",
          ARRAY_AGG(id ORDER BY "createdAt" ASC, id ASC) AS "participantIds"
        FROM "BetaParticipant"
        WHERE "userId" IS NOT NULL
        GROUP BY "userId"
        HAVING COUNT(*) > 1
        ORDER BY "userId" ASC
      `;
      break;
    case "orphaned_participant":
      rows = await prisma.$queryRaw<BetaParticipantValidationRow[]>`
        SELECT p.id AS "participantId", p."createdAt"
        FROM "BetaParticipant" p
        LEFT JOIN "BetaInvitation" bi ON bi."participantId" = p.id
        WHERE bi.id IS NULL
        ORDER BY p."createdAt" ASC, p.id ASC
      `;
      break;
  }

  return { check, label: meta.label, rows };
}

export async function runAllBetaParticipantValidationChecks(
  prisma: PrismaClient,
): Promise<BetaParticipantValidationResult[]> {
  const results: BetaParticipantValidationResult[] = [];
  for (const { check } of BETA_PARTICIPANT_VALIDATION_CHECKS) {
    results.push(await runBetaParticipantValidationCheck(prisma, check));
  }
  return results;
}

export function formatValidationReport(
  results: BetaParticipantValidationResult[],
): string {
  const lines: string[] = ["Beta participant validation report", ""];

  for (const result of results) {
    lines.push(`[${result.check}] ${result.label}`);
    lines.push(`  offending rows: ${result.rows.length}`);
    if (result.rows.length > 0) {
      lines.push(`  sample: ${JSON.stringify(result.rows.slice(0, 5))}`);
      if (result.rows.length > 5) {
        lines.push(`  ... and ${result.rows.length - 5} more`);
      }
    }
    lines.push("");
  }

  const failing = results.filter((result) => result.rows.length > 0);
  if (failing.length === 0) {
    lines.push("All checks passed.");
  } else {
    lines.push(
      `FAILED: ${failing.length} check(s) returned non-zero rows — Deployment B must not proceed.`,
    );
  }

  return lines.join("\n");
}
