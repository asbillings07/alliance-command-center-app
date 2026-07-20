"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
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
    description: "Live Feed of everything",
  },
  {
    label: "Beta",
    href: "/platform/beta",
    description: "Invitation management",
  },
];

export function PlatformNav() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 py-4">
      <ul className="space-y-1 px-3">
        {NAV_ITEMS.map((item) => {
          const isActive =
            pathname === item.href || pathname.startsWith(`${item.href}/`);

          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`
                  block px-3 py-2 rounded-lg text-sm transition-colors
                  ${
                    isActive
                      ? "bg-primary/10 text-primary font-medium"
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
  );
}

export function PlatformNavMobile({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const pathname = usePathname();

  if (!isOpen) return null;

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/50 lg:hidden"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="fixed inset-y-0 left-0 z-50 flex w-64 flex-col bg-surface border-r border-border lg:hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="font-semibold text-text-primary">Navigation</span>
          <button
            onClick={onClose}
            className="p-1 text-text-muted hover:text-text-primary"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 py-4">
          <ul className="space-y-1 px-3">
            {NAV_ITEMS.map((item) => {
              const isActive =
                pathname === item.href || pathname.startsWith(`${item.href}/`);

              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onClose}
                    className={`
                      block px-3 py-3 rounded-lg transition-colors
                      ${
                        isActive
                          ? "bg-primary/10 text-primary font-medium"
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

        <div className="border-t border-border p-3 space-y-1">
          <AccountNavLink fullWidth onClick={onClose} />
          <SignOutButton variant="ghost" fullWidth align="start" />
        </div>
      </div>
    </>
  );
}
