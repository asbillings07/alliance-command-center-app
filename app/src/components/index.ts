/**
 * Alliance Command Center Design System — Server/Shared Components
 *
 * Presentational components that are safe to render in Server Components.
 * Import these from the barrel:
 *
 * @example
 * import { PageLayout, Card, Badge, EmptyState } from "@/app/src/components";
 *
 * Interactive, client-only components (Button, Input, FormField, etc.) live in
 * the sibling "@/app/src/components/client" entrypoint.
 */

// Layout
export { PageLayout, type PageLayoutProps, type BreadcrumbItem } from "./PageLayout";
export { AuthLayout, AuthError, type AuthLayoutProps } from "./AuthLayout";

// Containers
export { Card, type CardProps, type CardHeaderProps, type CardBodyProps, type CardFooterProps } from "./Card";
export { EmptyState, EmptyStateCard, type EmptyStateProps } from "./EmptyState";

// Status
export { Badge, type BadgeProps, type BadgeVariant, type BadgeSize } from "./Badge";
