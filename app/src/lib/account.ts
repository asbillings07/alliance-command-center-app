import { prisma } from "./prisma";

/**
 * Account domain service.
 *
 * Encapsulates how a user reads and manages their own account. Keeping Prisma
 * behind this service (rather than in the action or page) means "Account" can
 * grow — avatar, preferences, locale — without leaking persistence details into
 * the routing/UI layer.
 *
 * Distinct from Identity: this service manages mutable, self-service profile
 * data. It deliberately does not touch email, which is the canonical identity
 * (ADR-013) and changed only through a dedicated verified flow.
 */

/** The maximum length we accept for a display name. */
export const DISPLAY_NAME_MAX_LENGTH = 50;

export type Account = {
  displayName: string;
  email: string;
};

export type ValidateDisplayNameResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

/**
 * Validate and normalize a display name. Pure and framework-free so it can be
 * unit-tested and shared as the single source of truth for display-name rules
 * (used by both account updates and registration).
 */
export function validateDisplayName(raw: unknown): ValidateDisplayNameResult {
  const value = typeof raw === "string" ? raw.trim() : "";

  if (value.length === 0) {
    return { ok: false, message: "Display name is required" };
  }

  if (value.length > DISPLAY_NAME_MAX_LENGTH) {
    return {
      ok: false,
      message: `Display name must be ${DISPLAY_NAME_MAX_LENGTH} characters or fewer`,
    };
  }

  return { ok: true, value };
}

/** Load the current user's account view. Returns null if the user is gone. */
export async function getAccount(userId: string): Promise<Account | null> {
  return prisma.user.findUnique({
    where: { id: userId },
    select: { displayName: true, email: true },
  });
}

/**
 * Persist a new display name for the user. The caller is responsible for
 * authenticating the user and validating the value via `validateDisplayName`.
 */
export async function updateDisplayName(
  userId: string,
  displayName: string
): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { displayName },
  });
}
