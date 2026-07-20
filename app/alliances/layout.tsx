import Link from "next/link";
import { auth } from "@/app/src/lib/auth";
import { FeedbackWidget, SignOutButton } from "@/app/src/components/client";
// Driver.js ships global CSS. Importing it here (a layout, the Next-sanctioned
// place for global styles) scopes it to the authenticated /alliances routes
// where contextual tours run, and keeps it off auth/marketing/platform pages.
// It must NOT be imported from TourButton: that component is re-exported by the
// shared client barrel, so a CSS side-effect there leaks onto every route that
// imports the barrel.
import "driver.js/dist/driver.css";

/**
 * Authenticated shell for the alliance section.
 *
 * Mirrors the platform console's layout pattern: a thin top bar that gives every
 * authenticated page an obvious way to leave the session. Living in a layout
 * (rather than the shared PageLayout) keeps the sign-out affordance scoped to
 * authenticated navigation and keeps server-only `auth()` out of the shared
 * component barrel, which is also consumed by Client Components.
 *
 * Sign Out is session-gated defensively; every /alliances route already
 * enforces authentication in its page, so this is effectively always present,
 * but the check keeps the affordance from rendering if a route ever renders
 * without a session.
 */
export default async function AlliancesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();

  return (
    // No min-h-screen here: the pages under /alliances already own the full
    // viewport height (PageLayout sets min-h-screen; confirm-member sets its
    // own). A second full-height wrapper would stack with the child's and, with
    // the sticky header, push the page past 100vh (extra scroll/whitespace).
    <div className="bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="flex items-center justify-between px-4 py-3 lg:px-6">
          <Link
            href="/app"
            className="text-sm font-semibold text-text-primary transition-colors hover:text-primary"
          >
            Alliance Command Center
          </Link>
          {session?.user && (
            <div className="flex items-center gap-2">
              <Link
                href="/account"
                className="text-sm font-medium text-text-secondary transition-colors hover:text-primary"
              >
                Account
              </Link>
              <SignOutButton variant="ghost" />
            </div>
          )}
        </div>
      </header>

      {children}

      {session?.user && <FeedbackWidget />}
    </div>
  );
}
