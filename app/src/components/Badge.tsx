import { ReactNode } from "react";

/**
 * Badge Variants
 *
 * Semantic variants only - badges communicate status, not decoration.
 *
 * - success: Positive status (green)
 * - warning: Needs attention (amber)
 * - danger: Critical issue (red)
 * - neutral: Default/inactive (gray)
 * - info: Informational (blue)
 */
export type BadgeVariant = "success" | "warning" | "danger" | "neutral" | "info";

/**
 * Badge Sizes
 */
export type BadgeSize = "sm" | "md";

/**
 * Badge Props
 */
export type BadgeProps = {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Optional icon before the label */
  icon?: ReactNode;
  /** Optional className for layout (margins, positioning only) */
  className?: string;
  children: ReactNode;
};

const variantClasses: Record<BadgeVariant, string> = {
  success: "bg-success/20 text-success border-success/30",
  warning: "bg-warning/20 text-warning border-warning/30",
  danger: "bg-danger/20 text-danger border-danger/30",
  neutral: "bg-text-muted/20 text-text-secondary border-text-muted/30",
  info: "bg-primary/20 text-primary border-primary/30",
};

const sizeClasses: Record<BadgeSize, string> = {
  sm: "px-2 py-0.5 text-xs",
  md: "px-2.5 py-1 text-sm",
};

/**
 * Badge Component
 *
 * Displays semantic status indicators.
 * Badges communicate meaning through color - never use decoratively.
 *
 * @example
 * // Status badges
 * <Badge variant="success">Active</Badge>
 * <Badge variant="warning">Pending</Badge>
 * <Badge variant="danger">Expired</Badge>
 *
 * // With icon
 * <Badge variant="success" icon={<CheckIcon />}>Complete</Badge>
 *
 * // Small size
 * <Badge variant="info" size="sm">New</Badge>
 */
export function Badge({
  variant = "neutral",
  size = "md",
  icon,
  className,
  children,
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 font-medium rounded-full border ${variantClasses[variant]} ${sizeClasses[size]} ${className ?? ""}`}
    >
      {icon && <span className="flex-shrink-0">{icon}</span>}
      {children}
    </span>
  );
}
