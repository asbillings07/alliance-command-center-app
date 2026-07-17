import { timingSafeEqual } from "node:crypto";
import { prisma } from "../prisma";

/**
 * Platform Bootstrap Service
 *
 * Handles the one-time initialization of the platform.
 * After initialization, this service becomes read-only.
 */

/**
 * Check if the platform has been initialized.
 * Platform is initialized when at least one platform admin exists in the database.
 *
 * This is a property of the database, not deployment configuration.
 */
export async function isPlatformInitialized(): Promise<boolean> {
  const adminCount = await prisma.user.count({
    where: { isPlatformAdmin: true },
  });
  return adminCount > 0;
}

/**
 * Get the list of emails allowed to initialize the platform.
 * This is used ONLY for bootstrap validation.
 *
 * After initialization, platform admin status is read from the database,
 * not from environment variables.
 */
export function getBootstrapAllowedEmails(): string[] {
  const parseEmails = (envValue: string | undefined): string[] => {
    if (!envValue) return [];
    return envValue
      .split(",")
      .map((email) => email.trim().toLowerCase())
      .filter((email) => email.length > 0);
  };

  const prodEmails = parseEmails(process.env.PLATFORM_ADMIN_EMAILS);
  const e2eEmails = parseEmails(process.env.PLATFORM_ADMIN_EMAILS_E2E);

  return [...new Set([...prodEmails, ...e2eEmails])];
}

/**
 * Check if an email is allowed to initialize the platform.
 * This is bootstrap validation only - it does NOT check if someone
 * is currently a platform admin.
 */
export function canInitializePlatform(email: string): boolean {
  const allowedEmails = getBootstrapAllowedEmails();
  return allowedEmails.includes(email.toLowerCase());
}

/**
 * Verify the bootstrap secret supplied during initialization.
 *
 * Knowing an allowed email is not proof of ownership. On a fresh
 * (uninitialized) deployment, anyone who guesses an email in
 * PLATFORM_ADMIN_EMAILS could otherwise claim the first platform admin
 * account. Requiring a separate deployment-only secret closes that gap.
 *
 * Behavior:
 * - If PLATFORM_BOOTSTRAP_SECRET is configured, the provided value must
 *   match it exactly (compared in constant time).
 * - If it is NOT configured, bootstrap is refused in production (fail closed)
 *   and allowed in development/test for local convenience.
 */
export function verifyBootstrapSecret(
  providedSecret: string | undefined | null
): boolean {
  const expected = process.env.PLATFORM_BOOTSTRAP_SECRET?.trim();

  if (!expected) {
    // No secret configured: refuse in production so a fresh deployment can't
    // be claimed with only an allowed email; permit in dev/test.
    return process.env.NODE_ENV !== "production";
  }

  const provided = providedSecret?.trim();
  if (!provided) {
    return false;
  }

  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");

  // timingSafeEqual requires equal-length buffers; unequal length is a mismatch.
  if (expectedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return timingSafeEqual(expectedBuffer, providedBuffer);
}
