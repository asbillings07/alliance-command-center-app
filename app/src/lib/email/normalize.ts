/**
 * Email normalization for Alliance Command Center.
 *
 * ADR-013 (as amended by #144): Google `sub` is the immutable authentication
 * anchor; email is the canonical normalized account address and a first-link/
 * participant-association key, but it is mutable profile data after linking.
 *
 * A single normalization function ensures consistency across:
 * - User account creation and credential sign-in
 * - Beta invitations and access requests
 * - Google OAuth first-link email matching
 * - Participant identity resolution (#174)
 * - Platform initialization and preview email allowlists
 * - Alliance invitation creation and acceptance matching
 * - CLI tooling and backfill scripts
 *
 * **Normalization policy:** lowercase + trim
 * - No Gmail-specific rules (no dot/plus-address collapsing)
 * - Simple, predictable, and preserves displayed email structure
 * - Preserves all address features (dots, plus-addressing, subdomains)
 * - Lossy transformation (case information is discarded)
 *
 * Usage: Import this shared function instead of inlining `email.toLowerCase().trim()`
 */

/**
 * Canonical stored form of an email: lowercased and trimmed.
 *
 * This is the normalization used for:
 * - User.email (always stored normalized, mutable after account creation)
 * - BetaInvitation.email and BetaInvitation.normalizedEmail
 * - AccessRequest.email and AccessRequest.normalizedEmail
 * - Credential sign-in email lookup
 * - Google OAuth email matching for first-link
 * - Platform admin email authorization
 * - Participant identity resolution (#174)
 *
 * Does NOT apply Gmail-specific transformations like:
 * - Removing dots from local part
 * - Removing +suffix addressing
 *
 * These rules would break non-Gmail addresses and make normalization
 * non-reversible from the displayed email, violating user expectations.
 */
export function normalizeEmail(raw: string): string {
  return raw.toLowerCase().trim();
}
