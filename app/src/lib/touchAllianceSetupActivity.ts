import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Bump an alliance's monotonic setup-activity clock inside the caller's
 * transaction. Uses a single atomic GREATEST() update so concurrent commits
 * cannot move the clock backward (#174).
 */
export async function touchAllianceSetupActivity(
  tx: Prisma.TransactionClient,
  allianceId: string,
  candidateTime: Date = new Date(),
): Promise<void> {
  await tx.$executeRaw`
    UPDATE "Alliance"
    SET "setupActivityAt" = GREATEST("setupActivityAt", ${candidateTime})
    WHERE id = ${allianceId}
  `;
}
