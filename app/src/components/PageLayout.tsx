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
  maxWidth?: "sm" | "md" | "lg" | "xl" | "2xl" | "4xl" | "6xl" | "full";
};

const maxWidthClasses = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-xl",
  "2xl": "max-w-2xl",
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
            <ol className="flex items-center gap-2 text-sm text-text-muted">
              {breadcrumb.map((item, index) => (
                <li key={index} className="flex items-center gap-2">
                  {index > 0 && (
                    <span className="text-text-disabled">/</span>
                  )}
                  {item.href ? (
                    <Link
                      href={item.href}
                      className="hover:text-text-secondary transition-colors"
                    >
                      {item.label}
                    </Link>
                  ) : (
                    <span className="text-text-secondary">{item.label}</span>
                  )}
                </li>
              ))}
            </ol>
          </nav>
        )}

        {/* Header: Title + Action */}
        <div className="flex items-start justify-between gap-4 mb-6">
          <div>
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
