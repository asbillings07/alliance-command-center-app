/**
 * Password policy — the single source of truth for password requirements.
 *
 * The same rules power server-side enforcement (register, initialize, reset)
 * and the client-side PasswordRequirements checklist, so what users see is
 * exactly what is enforced. This module is isomorphic: it has no server-only
 * imports and is safe to import from Client Components.
 */

export const PASSWORD_MIN_LENGTH = 8;

export type PasswordRule = {
  /** Stable identifier (used as a React key and in validation results). */
  id: string;
  /** Human-readable requirement shown in the UI checklist. */
  label: string;
  /** Whether the given password satisfies this rule. */
  test: (password: string) => boolean;
};

export const PASSWORD_RULES: readonly PasswordRule[] = [
  {
    id: "length",
    label: `At least ${PASSWORD_MIN_LENGTH} characters`,
    test: (password) => password.length >= PASSWORD_MIN_LENGTH,
  },
  {
    id: "uppercase",
    label: "An uppercase letter",
    test: (password) => /[A-Z]/.test(password),
  },
  {
    id: "lowercase",
    label: "A lowercase letter",
    test: (password) => /[a-z]/.test(password),
  },
  {
    id: "number",
    label: "A number",
    test: (password) => /[0-9]/.test(password),
  },
  {
    id: "special",
    label: "A special character",
    test: (password) => /[^A-Za-z0-9]/.test(password),
  },
];

export type PasswordValidationResult = {
  valid: boolean;
  /** Ids of the rules the password fails, in policy order. */
  failedRuleIds: string[];
  /** A single user-facing error message, or null when the password is valid. */
  message: string | null;
};

/**
 * Validate a password against every rule in the policy.
 *
 * Returns a structured result rather than throwing so callers (server actions)
 * can surface `message` directly and clients can inspect `failedRuleIds`.
 */
export function validatePassword(password: string): PasswordValidationResult {
  const failed = PASSWORD_RULES.filter((rule) => !rule.test(password));

  if (failed.length === 0) {
    return { valid: true, failedRuleIds: [], message: null };
  }

  const requirements = failed
    .map((rule) => rule.label.toLowerCase())
    .join(", ");

  return {
    valid: false,
    failedRuleIds: failed.map((rule) => rule.id),
    message: `Password must include: ${requirements}`,
  };
}
