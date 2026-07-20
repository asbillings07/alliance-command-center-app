/**
 * Password policy: the single source of truth for password rules.
 *
 * Deliberately pure and dependency-free (no bcrypt, no Prisma) so it can be
 * imported from both the server (account service, registration, bootstrap) and
 * Client Components (to advertise the rules in the UI) without pulling
 * server-only modules into the client bundle.
 */

/** Minimum password length (characters), shared across all password entry points. */
export const PASSWORD_MIN_LENGTH = 8;

/**
 * Maximum password length in UTF-8 bytes. bcrypt only hashes the first 72 bytes,
 * so anything longer would be silently truncated; reject it instead of hashing a
 * prefix. This is a byte limit, not a character limit: a multibyte password can
 * exceed 72 bytes while having fewer than 72 JavaScript characters.
 */
export const PASSWORD_MAX_BYTES = 72;

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

  // Enforce bcrypt's 72-byte input limit using UTF-8 byte length, not string
  // length, so a multibyte password can't slip past validation and then be
  // silently truncated by bcrypt. TextEncoder (not Buffer) so this stays usable
  // from Client Components — Buffer isn't available in the browser by default.
  if (new TextEncoder().encode(raw).length > PASSWORD_MAX_BYTES) {
    return {
      ok: false,
      message: `Password must be ${PASSWORD_MAX_BYTES} bytes or fewer`,
    };
  }

  return { ok: true, value: raw };
}
