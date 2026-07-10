import { prisma } from "../prisma";
import { redirect } from "next/navigation";
import { requireAuth } from "./requireAuth";
import {
  Permissions,
  Permission,
  buildPermissionSet,
  hasPermission,
  AuthorizationContext,
} from "./permissions";

export type RequireAllianceAccessOptions = {
  allianceId: string;
  requiredPermission?: Permission;
};

/**
 * Unified entry point for alliance authorization.
 *
 * - Authenticates the user
 * - Loads their alliance membership
 * - Builds the permission set from their role (evaluated once)
 * - Checks the required permission against the resolved set
 * - Returns the full AuthorizationContext
 *
 * Usage:
 *   const auth = await requireAllianceAccess({
 *     allianceId,
 *     requiredPermission: Permissions.MANAGE_MEMBERS,
 *   });
 */
export async function requireAllianceAccess(
  options: RequireAllianceAccessOptions
): Promise<AuthorizationContext> {
  const user = await requireAuth();

  const membership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId: options.allianceId,
        userId: user.id,
      },
    },
  });

  if (!membership) {
    redirect("/app");
  }

  const permissions = buildPermissionSet(membership.role);

  const required = options.requiredPermission ?? Permissions.VIEW_ALLIANCE;
  if (!hasPermission(permissions, required)) {
    redirect("/app");
  }

  return { user, membership, permissions };
}

/**
 * @deprecated Use requireAllianceAccess with options object instead.
 * This function is kept for backwards compatibility during migration.
 */
export async function requireAllianceAccessLegacy(
  allianceId: string,
  userId: string
) {
  const membership = await prisma.allianceMembership.findUnique({
    where: {
      allianceId_userId: {
        allianceId,
        userId,
      },
    },
  });

  if (!membership) {
    redirect("/app");
  }

  return membership;
}
