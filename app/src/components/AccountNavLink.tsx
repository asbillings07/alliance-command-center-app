"use client";

import { Button } from "./Button";

type AccountNavLinkProps = {
  /** Stretch to fill its container and left-align, for stacked nav footers. */
  fullWidth?: boolean;
  /** Called on navigation, e.g. to close a mobile drawer. */
  onClick?: () => void;
};

/**
 * "Account" navigation affordance.
 *
 * Renders as a ghost Button (link) so it shares the exact styling, sizing, and
 * interaction states of the adjacent {@link SignOutButton}. This is what keeps
 * the Account / Sign Out nav group visually consistent everywhere it appears
 * (desktop sidebar, mobile drawer, top header). Pass `fullWidth` in stacked
 * footers so both rows left-align and match height.
 */
export function AccountNavLink({ fullWidth = false, onClick }: AccountNavLinkProps) {
  return (
    <Button
      href="/account"
      variant="ghost"
      size="sm"
      fullWidth={fullWidth}
      align={fullWidth ? "start" : "center"}
      onClick={onClick}
    >
      <AccountGlyph />
      Account
    </Button>
  );
}

function AccountGlyph() {
  return (
    <svg
      className="mr-2 h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
      />
    </svg>
  );
}
