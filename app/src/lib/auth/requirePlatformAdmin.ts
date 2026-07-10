import { redirect } from "next/navigation";
import { requireAuth } from "./requireAuth";

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
 */

const PLATFORM_ADMIN_EMAILS = ["abdevelops@gmail.com"];

/**
 * Require the current user to be a platform administrator.
 *
 * Platform admins can access /platform/* routes for operational
 * visibility and support tools.
 *
 * This is intentionally simple - no database, no schema, no UI.
 * Just a hardcoded list of trusted operators.
 */
export async function requirePlatformAdmin() {
  const user = await requireAuth();

  if (!PLATFORM_ADMIN_EMAILS.includes(user.email)) {
    redirect("/app");
  }

  return user;
}

/**
 * Check if a user is a platform admin without requiring it.
 * Useful for conditional UI elements.
 */
export function isPlatformAdmin(email: string): boolean {
  return PLATFORM_ADMIN_EMAILS.includes(email);
}
