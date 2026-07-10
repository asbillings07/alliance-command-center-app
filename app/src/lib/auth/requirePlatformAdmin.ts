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

/**
 * Get the list of platform admin emails from environment config.
 * Emails are normalized to lowercase for case-insensitive comparison.
 */
function getPlatformAdminEmails(): string[] {
  const envValue = process.env.PLATFORM_ADMIN_EMAILS;
  if (!envValue) {
    return [];
  }
  return envValue
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

/**
 * Require the current user to be a platform administrator.
 *
 * Platform admins can access /platform/* routes for operational
 * visibility and support tools.
 *
 * This is intentionally simple - no database, no schema, no UI.
 * Admin emails are configured via PLATFORM_ADMIN_EMAILS environment variable.
 */
export async function requirePlatformAdmin() {
  const user = await requireAuth();

  const adminEmails = getPlatformAdminEmails();
  if (!adminEmails.includes(user.email.toLowerCase())) {
    redirect("/app");
  }

  return user;
}

/**
 * Check if a user is a platform admin without requiring it.
 * Useful for conditional UI elements.
 * Comparison is case-insensitive.
 */
export function isPlatformAdmin(email: string): boolean {
  const adminEmails = getPlatformAdminEmails();
  return adminEmails.includes(email.toLowerCase());
}
