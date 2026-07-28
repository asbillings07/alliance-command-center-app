import Link from "next/link";
import Image from "next/image";
import { auth } from "@/app/src/lib/auth";
import { isPlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  AccountNavLink,
  FeedbackWidget,
  SignOutButton,
} from "@/app/src/components/client";
import { PlatformConsoleNavLink } from "./components/PlatformConsoleNavLink";
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
  const showPlatformConsole =
    session?.user?.id != null && (await isPlatformAdmin(session.user.id));

  return (
    // No min-h-screen here: the pages under /alliances already own the full
    // viewport height (PageLayout sets min-h-screen; confirm-member sets its
    // own). A second full-height wrapper would stack with the child's and, with
    // the sticky header, push the page past 100vh (extra scroll/whitespace).
    <div className="bg-background">
      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="flex min-w-0 items-center justify-between gap-2 px-4 py-3 lg:px-6">
          <Link
            href="/app"
            aria-label="Alliance Command Center"
            className="flex min-w-0 shrink items-center gap-2.5 text-sm font-semibold text-text-primary transition-colors hover:text-primary"
          >
            <Image
              src="/icon.png"
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 shrink-0 rounded-md object-cover"
            />
            <span className="hidden truncate sm:inline">
              Alliance Command Center
            </span>
          </Link>
          {session?.user && (
            <div className="flex shrink-0 items-center gap-0.5 md:gap-1">
              {showPlatformConsole && <PlatformConsoleNavLink compact />}
              <AccountNavLink compact />
              <SignOutButton variant="ghost" compact />
            </div>
          )}
        </div>
      </header>

      {children}

      {session?.user && <FeedbackWidget />}
    </div>
  );
}
