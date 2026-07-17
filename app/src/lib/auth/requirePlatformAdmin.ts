import { redirect } from "next/navigation";
import { requireAuth } from "./requireAuth";
import { prisma } from "../prisma";

/**
 * Platform Authorization
 *
 * This is completely separate from Alliance authorization.
 *
 * Alliance Roles (OWNER, ADMIN, LEADER, VIEWER) control access
 * within an alliance.
 *
 * Platform Admin controls access to ACC operations:
 * - All alliances
 * - All users
 * - Beta invitations
 * - Platform health
 * - Support tools
 *
 * These are different domains with different responsibilities.
 *
 * Platform admin status is stored in the database (User.isPlatformAdmin),
 * not in environment variables. Environment variables are only used
 * for bootstrap validation (who CAN initialize the platform).
 */

/**
 * Require the current user to be a platform administrator.
 *
 * Platform admins can access /platform/* routes for operational
 * visibility and support tools.
 *
 * Admin status is read from the database (User.isPlatformAdmin).
 */
export async function requirePlatformAdmin() {
  const session = await requireAuth();

  const user = await prisma.user.findUnique({
    where: { id: session.id },
    select: { isPlatformAdmin: true },
  });

  if (!user?.isPlatformAdmin) {
    redirect("/app");
  }

  return session;
}

/**
 * Check if a user is a platform admin without requiring it.
 * Useful for conditional UI elements.
 *
 * Reads from the database, not environment variables.
 */
export async function isPlatformAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPlatformAdmin: true },
  });
  return user?.isPlatformAdmin ?? false;
}
