import { ReactNode } from "react";
import Link from "next/link";
import { BrandLockup } from "./BrandLockup";

/**
 * AuthLayout Props
 */
export type AuthLayoutProps = {
  /** Icon to display at the top (optional) */
  icon?: ReactNode;
  /** Page title */
  title: string;
  /** Subtitle/description */
  subtitle?: string;
  /** Main content */
  children: ReactNode;
  /** Footer content (links, etc.) */
  footer?: ReactNode;
};

/**
 * AuthLayout Component
 *
 * Centered card layout for authentication pages.
 * Used for login, register, redeem, invite flows.
 *
 * @example
 * <AuthLayout
 *   icon={<KeyIcon />}
 *   title="Sign In"
 *   subtitle="Welcome back to Alliance Command Center"
 *   footer={<Link href="/register">Create account</Link>}
 * >
 *   <LoginForm />
 * </AuthLayout>
 */
export function AuthLayout({
  icon,
  title,
  subtitle,
  children,
  footer,
}: AuthLayoutProps) {
  return (
    <div className="mx-auto flex min-h-screen w-full max-w-6xl flex-col px-5 sm:px-8 lg:px-10">
      <header className="border-b border-border py-6 sm:py-8">
        <Link href="/" aria-label="Alliance Command Center home" className="inline-flex rounded-lg focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary">
          <BrandLockup />
        </Link>
      </header>

      <main className="grid flex-1 items-center gap-10 py-8 sm:py-12 lg:grid-cols-[1fr_1fr] lg:gap-20">
        <aside className="hidden lg:block" aria-label="About Alliance Command Center">
          <p className="brand-kicker mb-5">A shared view. A stronger alliance.</p>
          <p className="text-4xl font-semibold leading-tight tracking-tight text-text-primary">
            The whole picture.<br />
            <span className="text-primary">One shared place.</span>
          </p>
          <p className="mt-5 max-w-sm text-base leading-relaxed text-text-secondary">
            Your people, their participation, and the context behind every decision — connected.
          </p>
          <div aria-hidden="true" className="brand-rule my-8 w-16" />
          <p className="max-w-sm text-sm leading-relaxed text-text-muted">
            Built for Last War leadership teams. Keep the numbers in perspective and the people at the center.
          </p>
        </aside>

        <div className="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-border bg-surface">
          <div aria-hidden="true" className="brand-rule" />
          <div className="p-6 sm:p-8">
            <div className="mb-6">
              {icon && (
                <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-surface-secondary text-primary">
                  {icon}
                </div>
              )}
              <h1 className="text-2xl font-semibold tracking-tight text-text-primary">{title}</h1>
              {subtitle && <p className="mt-2 text-sm leading-relaxed text-text-muted">{subtitle}</p>}
            </div>

            {children}

            {footer && (
              <div className="mt-6 border-t border-border pt-5 text-center text-sm text-text-muted">
                {footer}
              </div>
            )}
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-5 text-xs text-text-muted">
        Built for alliance leadership.
      </footer>
    </div>
  );
}

/**
 * AuthError - Displays form errors in auth layouts
 */
export function AuthError({ children }: { children: ReactNode }) {
  if (!children) return null;

  return (
    <div className="mb-4 p-3 bg-danger/10 border border-danger/20 rounded-lg">
      <p className="text-sm text-danger-light">{children}</p>
    </div>
  );
}
