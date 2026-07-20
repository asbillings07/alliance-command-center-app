import bcrypt from "bcrypt";
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

/** Minimum password length, shared by registration, bootstrap, and account. */
export const PASSWORD_MIN_LENGTH = 8;
/**
 * Maximum password length. bcrypt only hashes the first 72 bytes, so anything
 * longer would be silently truncated; reject it instead of hashing a prefix.
 */
export const PASSWORD_MAX_LENGTH = 72;

/** Work factor for bcrypt hashing, consistent across the codebase. */
const BCRYPT_COST = 12;

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

// ============================================================
// Security: password credential + sign-in methods
// ============================================================

export type ValidatePasswordResult =
  | { ok: true; value: string }
  | { ok: false; message: string };

/**
 * Validate a password. Pure and framework-free so it is the single source of
 * truth for password rules (account, registration, and platform bootstrap).
 *
 * Unlike display names, passwords are NOT trimmed: leading/trailing whitespace
 * can be intentional, and trimming would silently alter the user's secret.
 */
export function validatePassword(raw: unknown): ValidatePasswordResult {
  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, message: "Password is required" };
  }

  if (raw.length < PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters`,
    };
  }

  if (raw.length > PASSWORD_MAX_LENGTH) {
    return {
      ok: false,
      message: `Password must be ${PASSWORD_MAX_LENGTH} characters or fewer`,
    };
  }

  return { ok: true, value: raw };
}

export type SignInMethods = {
  /** Whether email + password sign-in is available for this account. */
  hasPassword: boolean;
  /** Whether a Google account is linked to this account. */
  hasGoogle: boolean;
};

/**
 * Report which sign-in capabilities the account has, derived from the presence
 * of the credential columns (ADR-013). Never returns the hash or subject
 * themselves — only whether each capability exists.
 */
export async function getSignInMethods(
  userId: string
): Promise<SignInMethods | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true, googleSubject: true },
  });

  if (!user) {
    return null;
  }

  return {
    hasPassword: user.passwordHash !== null,
    hasGoogle: user.googleSubject !== null,
  };
}

/**
 * Verify a plaintext password against the stored hash. Returns false when the
 * account has no password credential (Google-only) rather than throwing.
 */
export async function verifyPassword(
  userId: string,
  plain: string
): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { passwordHash: true },
  });

  if (!user?.passwordHash) {
    return false;
  }

  return bcrypt.compare(plain, user.passwordHash);
}

/**
 * Set (or replace) the account's password. The caller authenticates the user,
 * validates the value via `validatePassword`, and — when a password already
 * exists — verifies the current one before calling this.
 */
export async function setPassword(
  userId: string,
  plain: string
): Promise<void> {
  const passwordHash = await bcrypt.hash(plain, BCRYPT_COST);
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });
}
