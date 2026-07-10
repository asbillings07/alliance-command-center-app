import { ButtonHTMLAttributes, forwardRef } from "react";
import Link from "next/link";

/**
 * Button Variants
 *
 * - primary: Main action (blue, filled)
 * - secondary: Alternative action (gray border)
 * - ghost: Tertiary action (transparent)
 * - danger: Destructive action (red)
 * - link: Navigation (text only)
 */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "link";

/**
 * Button Sizes
 */
export type ButtonSize = "sm" | "md" | "lg";

/**
 * Button Props
 */
export type ButtonProps = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** If provided, renders as a Link instead of button */
  href?: string;
  /** Full width button */
  fullWidth?: boolean;
  /** Loading state */
  loading?: boolean;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className">;

const baseClasses =
  "inline-flex items-center justify-center font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed";

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    "bg-primary text-white hover:bg-primary-hover",
  secondary:
    "bg-transparent border border-border text-text-secondary hover:bg-surface-secondary hover:text-text-primary hover:border-border-hover",
  ghost:
    "bg-transparent text-text-secondary hover:bg-surface-secondary hover:text-text-primary",
  danger:
    "bg-danger text-white hover:bg-danger/90",
  link:
    "bg-transparent text-primary hover:text-primary-hover underline-offset-4 hover:underline p-0",
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-sm",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

/**
 * Button Component
 *
 * Expresses intent through variants, not implementation classes.
 *
 * @example
 * // Primary action
 * <Button variant="primary">Save Changes</Button>
 *
 * // Secondary action
 * <Button variant="secondary">Cancel</Button>
 *
 * // Destructive action
 * <Button variant="danger">Delete</Button>
 *
 * // Navigation
 * <Button variant="link" href="/settings">Settings</Button>
 *
 * // Loading state
 * <Button variant="primary" loading>Saving...</Button>
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      variant = "primary",
      size = "md",
      href,
      fullWidth = false,
      loading = false,
      disabled,
      children,
      ...props
    },
    ref
  ) {
    const classes = [
      baseClasses,
      variantClasses[variant],
      variant !== "link" && sizeClasses[size],
      fullWidth && "w-full",
    ]
      .filter(Boolean)
      .join(" ");

    const content = (
      <>
        {loading && (
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        )}
        {children}
      </>
    );

    if (href && !disabled) {
      return (
        <Link href={href} className={classes}>
          {content}
        </Link>
      );
    }

    return (
      <button
        ref={ref}
        className={classes}
        disabled={disabled || loading}
        {...props}
      >
        {content}
      </button>
    );
  }
);
