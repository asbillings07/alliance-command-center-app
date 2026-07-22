import Link from "next/link";

/**
 * A quiet "Back to Setup" affordance for pages that a leader reaches from the
 * Setup checklist (typically via a guided tour deep link).
 *
 * It stays visible so a user can return to Setup on their own terms after they
 * finish the on-page task — the tour flow deliberately leaves them here rather
 * than whisking them back, and this is the user-controlled way home. Rendered in
 * the PageLayout `action` slot; styled like a breadcrumb link (low emphasis, and
 * a color pairing that clears WCAG AA on the header background).
 */
export function BackToSetupLink({ allianceId }: { allianceId: string }) {
  return (
    <Link
      href={`/alliances/${allianceId}/setup`}
      className="inline-flex items-center gap-1 text-sm text-text-muted transition-colors hover:text-text-secondary"
    >
      <span aria-hidden="true">←</span>
      Back to Setup
    </Link>
  );
}
