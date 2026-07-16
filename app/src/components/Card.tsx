import { ReactNode } from "react";

/**
 * Card Props
 */
export type CardProps = {
  children: ReactNode;
  /** Additional CSS classes for layout (not design) */
  className?: string;
  /** Padding size */
  padding?: "none" | "sm" | "md" | "lg";
};

const paddingClasses = {
  none: "",
  sm: "p-4",
  md: "p-6",
  lg: "p-8",
};

/**
 * Card.Header - Section title area
 */
export type CardHeaderProps = {
  children: ReactNode;
  /** Optional action element (button, link) */
  action?: ReactNode;
  /** Render as div instead of h2 (use when content already contains heading) */
  as?: "h2" | "div";
};

function CardHeader({ children, action, as = "h2" }: CardHeaderProps) {
  const Title = as;
  return (
    <div className="flex items-center justify-between mb-4">
      <Title className="text-lg font-semibold text-text-primary">{children}</Title>
      {action && <div>{action}</div>}
    </div>
  );
}

/**
 * Card.Body - Main content area
 */
export type CardBodyProps = {
  children: ReactNode;
  className?: string;
};

function CardBody({ children, className = "" }: CardBodyProps) {
  return <div className={className}>{children}</div>;
}

/**
 * Card.Footer - Actions area
 */
export type CardFooterProps = {
  children: ReactNode;
  /** Alignment of footer content */
  align?: "left" | "center" | "right" | "between";
};

const alignClasses = {
  left: "justify-start",
  center: "justify-center",
  right: "justify-end",
  between: "justify-between",
};

function CardFooter({ children, align = "right" }: CardFooterProps) {
  return (
    <div
      className={`flex items-center gap-3 mt-4 pt-4 border-t border-border ${alignClasses[align]}`}
    >
      {children}
    </div>
  );
}

/**
 * Card Component
 *
 * A consistent content container following the design system.
 * Uses design tokens for surface color, border, and radius.
 *
 * @example
 * <Card>
 *   <Card.Header>Section Title</Card.Header>
 *   <Card.Body>Content here</Card.Body>
 *   <Card.Footer>Actions</Card.Footer>
 * </Card>
 */
function CardBase({ children, className = "", padding = "md" }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-lg ${paddingClasses[padding]} ${className}`}
    >
      {children}
    </div>
  );
}

export const Card = Object.assign(CardBase, {
  Header: CardHeader,
  Body: CardBody,
  Footer: CardFooter,
});
