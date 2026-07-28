"use client";

import { Button } from "@/app/src/components/Button";

type PlatformConsoleNavLinkProps = {
  /** Icon-only below md so the tenant header fits narrow viewports. */
  compact?: boolean;
};

/**
 * Platform Console navigation affordance for dual-role operators in the tenant header.
 */
export function PlatformConsoleNavLink({
  compact = false,
}: PlatformConsoleNavLinkProps) {
  return (
    <Button
      href="/platform/overview"
      variant="ghost"
      size="sm"
      aria-label={compact ? "Platform Console" : undefined}
    >
      <PlatformConsoleGlyph compact={compact} />
      {compact ? (
        <span className="hidden md:inline">Platform Console</span>
      ) : (
        "Platform Console"
      )}
    </Button>
  );
}

function PlatformConsoleGlyph({ compact }: { compact: boolean }) {
  return (
    <svg
      className={compact ? "h-4 w-4 md:mr-2" : "mr-2 h-4 w-4"}
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
        d="M4 5a1 1 0 011-1h4a1 1 0 011 1v5a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v2a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 12a1 1 0 011-1h4a1 1 0 011 1v7a1 1 0 01-1 1h-4a1 1 0 01-1-1v-7z"
      />
    </svg>
  );
}
