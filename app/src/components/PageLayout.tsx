import Link from "next/link";
import { ReactNode } from "react";

/**
 * Breadcrumb item definition
 */
export type BreadcrumbItem = {
  label: string;
  href?: string;
};

/**
 * PageLayout Props
 *
 * Implements the Page Pattern from the design system:
 * Breadcrumb → Title → Description → Primary Action → Content
 */
export type PageLayoutProps = {
  /** Breadcrumb trail - last item is current page (no href) */
  breadcrumb?: BreadcrumbItem[];
  /** Page title (H1) */
  title: string;
  /** Optional page description */
  description?: string;
  /** Optional primary action button/link */
  action?: ReactNode;
  /** Page content */
  children: ReactNode;
  /** Maximum width constraint */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "3xl" | "4xl" | "6xl" | "full";
};

const maxWidthClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
  "3xl": "max-w-3xl",
  "4xl": "max-w-4xl",
  "6xl": "max-w-6xl",
  full: "max-w-full",
};

/**
 * PageLayout Component
 *
 * Provides consistent page structure across the application.
 * Every page should use this component to maintain visual consistency.
 *
 * @example
 * <PageLayout
 *   breadcrumb={[
 *     { label: "Alliance", href: "/alliances/123" },
 *     { label: "Members" }
 *   ]}
 *   title="Leadership Roster"
 *   description="Manage alliance members and their roles"
 *   action={<Button variant="primary">Add Member</Button>}
 * >
 *   {content}
 * </PageLayout>
 */
export function PageLayout({
  breadcrumb,
  title,
  description,
  action,
  children,
  maxWidth = "4xl",
}: PageLayoutProps) {
  return (
    <div className="min-h-screen bg-background">
      <div className={`mx-auto ${maxWidthClasses[maxWidth]} p-8`}>
        {/* Breadcrumb */}
        {breadcrumb && breadcrumb.length > 0 && (
          <nav className="mb-4" aria-label="Breadcrumb">
            {/*
              flex-wrap lets the whole trail drop to a second line at narrow
              widths instead of forcing the row wider than the viewport.
              min-w-0 on each item is still required on top of that: flex
              items default to min-width: auto, so a label with no natural
              break points (e.g. a long hyphenated file name in the Import
              History breadcrumb) refuses to shrink below its own max content
              width and overflows even inside a wrapped flex row — the same
              class of bug the header title/action row above already guards
              against with min-w-0. break-words lets long labels wrap
              word-by-word once the item is allowed to shrink.
            */}
            <ol className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-text-muted">
              {breadcrumb.map((item, index) => (
                <li key={index} className="flex items-center gap-2 min-w-0">
                  {index > 0 && (
                    <span className="text-text-disabled">/</span>
                  )}
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="hover:text-text-secondary transition-colors break-words"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span className="text-text-secondary break-words">{item.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        {/*
          Header: Title + Action. `flex-wrap` lets the action drop to its own
          line instead of forcing the row wider than the viewport — without
          it, a title long enough to compete with `action`'s `flex-shrink-0`
          for space causes real horizontal page overflow at narrow widths
          (#264 PR5 caught this at 320px; it isn't specific to any one page,
          since every PageLayout consumer shares this header). `min-w-0`
          lets the title block itself shrink below its text's natural
          (unwrapped) width, the same flex default-sizing fix.
        */}
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
            {description && (
              <p className="mt-1 text-sm text-text-muted">{description}</p>
            )}
          </div>
          {action && <div className="flex-shrink-0">{action}</div>}
        </div>

        {/* Content */}
        <div>{children}</div>
      </div>
    </div>
  );
}
