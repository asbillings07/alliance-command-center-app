import "server-only";
import type { Prisma } from "@/app/generated/prisma/client";
import type { AllianceRole, MetricEntryMethod } from "@/app/generated/prisma/enums";
import { buildPermissionSet, hasPermission, Permissions, type Permission } from "@/app/src/lib/auth/permissions";

/** Capture the authenticated actor at the write, never from import/form data.
 * Share locks serialize role/profile changes against this transaction, so the
 * saved snapshot describes the authorization that actually admitted the write.
 * Call once per transaction; it covers all entries in that atomic batch.
 */
export async function metricEntryProvenance(
  tx: Prisma.TransactionClient,
  allianceId: string,
  userId: string,
  entryMethod: MetricEntryMethod,
  additionalPermissions: readonly Permission[] = [],
) {
  const [actor] = await tx.$queryRaw<{ id: string; displayName: string; role: AllianceRole }[]>`
    SELECT u."id", u."displayName", m."role"
    FROM "AllianceMembership" m JOIN "User" u ON u."id" = m."userId"
    WHERE m."allianceId" = ${allianceId} AND m."userId" = ${userId}
    FOR SHARE OF m, u
  `;
  if (!actor || [Permissions.IMPORT_METRICS, ...additionalPermissions].some(
    (permission) => !hasPermission(buildPermissionSet(actor.role), permission),
  )) {
    throw new Error("Your permission to record metrics has changed. Reload and try again.");
  }
  return {
    enteredByUserId: actor.id,
    enteredByName: actor.displayName.trim() || "Unnamed account",
    enteredByRole: actor.role,
    entryMethod,
  };
}
