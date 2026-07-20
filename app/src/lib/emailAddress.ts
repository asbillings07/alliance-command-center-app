/**
 * Pure email-address helpers (normalization + format), dependency-free so they
 * can be shared by server actions, domain services, and tests without importing
 * Prisma or a provider.
 *
 * Email is the canonical account identity (ADR-013), so keeping a single
 * definition of "normalized form" and "valid format" here avoids those rules
 * drifting apart across the codebase.
 */

/** Canonical stored form of an email: lowercased and trimmed. */
export function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}

/**
 * Validate email format. Simplified RFC 5322 (local@domain.tld) with no
 * whitespace and sane length bounds. Browser validation can be bypassed, so
 * callers enforce this server-side.
 */
export function isValidEmailFormat(email: string): boolean {
  const trimmed = email.trim();
  if (trimmed.length < 5 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed);
}
