"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { AdminAllianceWorkspace } from "@/app/src/lib/platform/adminWorkspace";
import { Button } from "@/app/src/components/Button";
import { AccountNavLink, SignOutButton } from "@/app/src/components/client";

type NavItem = {
  label: string;
  href: string;
  description: string;
};

const NAV_ITEMS: NavItem[] = [
  {
    label: "Overview",
    href: "/platform/overview",
    description: "Is the beta healthy? Is anyone stuck?",
  },
  {
    label: "Setup",
    href: "/platform/setup",
    description: "Which alliances are onboarding?",
  },
  {
    label: "Support",
    href: "/platform/support",
    description: "Search, lookup, jump into alliance",
  },
  {
    label: "Activity",
    href: "/platform/activity",
    description: "Recent platform activity",
  },
  {
    label: "Logs",
    href: "/platform/activity/import-errors",
    description: "Investigate import errors",
  },
  {
    label: "Beta",
    href: "/platform/beta",
    description: "Invitation management",
  },
  {
    label: "Feedback",
    href: "/platform/feedback",
    description: "Triage tester feedback",
  },
];

// Nested destinations such as the import log have their own menu entry.
function currentNavItem(pathname: string) {
  return NAV_ITEMS.filter(item => pathname === item.href || pathname.startsWith(item.href + "/"))
    .sort((a, b) => b.href.length - a.href.length)[0];
}

function WorkspaceNavLink({
  workspace,
  fullWidth = false,
  onClick,
}: {
  workspace: AdminAllianceWorkspace;
  fullWidth?: boolean;
  onClick?: () => void;
}) {
  if (workspace.kind === "none") {
    return null;
  }

  const label =
    workspace.kind === "single" ? "Alliance workspace" : "My alliances";

  return (
    <Button
      href={workspace.href}
      variant="ghost"
      size="sm"
      fullWidth={fullWidth}
      align={fullWidth ? "start" : "center"}
      onClick={onClick}
    >
      {label}
    </Button>
  );
}

function PlatformNavFooter({
  workspace,
  onNavigate,
}: {
  workspace: AdminAllianceWorkspace;
  onNavigate?: () => void;
}) {
  return (
    <div className="border-t border-border p-3 space-y-1">
      <WorkspaceNavLink workspace={workspace} fullWidth onClick={onNavigate} />
      <AccountNavLink fullWidth onClick={onNavigate} />
      <SignOutButton variant="ghost" fullWidth align="start" />
    </div>
  );
}

export function PlatformNav({
  workspace,
}: {
  workspace: AdminAllianceWorkspace;
}) {
  const current = currentNavItem(usePathname());

  return (
    <div className="flex flex-col flex-1">
      <nav className="flex-1 py-4">
        <ul className="space-y-1 px-3">
          {NAV_ITEMS.map((item) => {
            const isActive = item === current;

            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={isActive ? "page" : undefined}
                  className={`
                  block px-3 py-2 rounded-lg text-sm transition-colors
                  ${
                    isActive
                      ? "bg-brand-selection text-brand-text font-medium ring-1 ring-brand-violet/50"
                      : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                  }
                `}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      <PlatformNavFooter workspace={workspace} />
    </div>
  );
}

export function PlatformNavMobile({
  isOpen,
  onClose,
  workspace,
}: {
  isOpen: boolean;
  onClose: () => void;
  workspace: AdminAllianceWorkspace;
}) {
  const current = currentNavItem(usePathname());

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-brand-surface border-r border-border lg:hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold text-text-primary">Navigation</span>
          <button
            onClick={onClose}
            aria-label="Close navigation menu"
            className="p-1 text-text-muted hover:text-text-primary"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="min-h-0 flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-3">
            {NAV_ITEMS.map((item) => {
              const isActive = item === current;

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={isActive ? "page" : undefined}
                    onClick={onClose}
                    className={`
                      block px-3 py-3 rounded-lg transition-colors
                      ${
                        isActive
                          ? "bg-brand-selection text-brand-text font-medium ring-1 ring-brand-violet/50"
                          : "text-text-secondary hover:bg-surface-secondary hover:text-text-primary"
                      }
                    `}
                  >
                    <div className="text-sm">{item.label}</div>
                    <div className="text-xs text-text-muted mt-0.5">
                      {item.description}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <PlatformNavFooter workspace={workspace} onNavigate={onClose} />
      </div>
    </>
  );
}
