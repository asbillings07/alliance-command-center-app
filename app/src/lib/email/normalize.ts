/**
 * Email normalization for Alliance Command Center.
 *
 * Email is the canonical account identity (ADR-013), so a single normalization
 * function ensures consistency across beta invitations, access requests, user
 * accounts, and participant resolution.
 *
 * Normalization: lowercase + trim
 * - No Gmail-specific rules (no dot/plus-address collapsing)
 * - Simple, predictable, and reversible from displayed email
 *
 * Usage: Import this shared function instead of inlining email.toLowerCase().trim()
 */

/**
 * Canonical stored form of an email: lowercased and trimmed.
 *
 * This is the normalization used for:
 * - BetaInvitation.normalizedEmail
 * - AccessRequest.normalizedEmail
 * - User.email (always stored normalized)
 * - Participant identity resolution (#174)
 *
 * Does NOT apply Gmail-specific transformations like:
 * - Removing dots from local part
 * - Removing +suffix addressing
 *
 * These rules would break non-Gmail addresses and make normalization
 * non-reversible from the displayed email.
 */
export function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}
