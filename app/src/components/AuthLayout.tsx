import { ReactNode } from "react";
import { Card } from "./Card";

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
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <div className="w-full max-w-md">
        <Card>
          {/* Header */}
          <div className="text-center mb-6">
            {icon && (
              <div className="w-16 h-16 mx-auto mb-4 bg-primary/20 rounded-full flex items-center justify-center text-primary">
                {icon}
              </div>
            )}
            <h1 className="text-2xl font-bold text-text-primary">{title}</h1>
            {subtitle && (
              <p className="text-text-muted mt-1 text-sm">{subtitle}</p>
            )}
          </div>

          {/* Content */}
          {children}

          {/* Footer */}
          {footer && (
            <div className="mt-6 pt-6 border-t border-border text-center text-sm text-text-muted">
              {footer}
            </div>
          )}
        </Card>
      </div>
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
      <p className="text-sm text-danger">{children}</p>
    </div>
  );
}
