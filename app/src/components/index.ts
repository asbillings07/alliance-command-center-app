/**
 * Alliance Command Center Design System Components
 *
 * Import components from this barrel file:
 *
 * @example
 * import { Button, Card, Badge, Input, PageLayout, EmptyState } from "@/app/src/components";
 */

// Layout
export { PageLayout, type PageLayoutProps, type BreadcrumbItem } from "./PageLayout";
export { AuthLayout, AuthError, type AuthLayoutProps } from "./AuthLayout";

// Containers
export { Card, type CardProps, type CardHeaderProps, type CardBodyProps, type CardFooterProps } from "./Card";
export { EmptyState, EmptyStateCard, type EmptyStateProps } from "./EmptyState";

// Actions
export { Button, type ButtonProps, type ButtonVariant, type ButtonSize } from "./Button";

// Forms
export {
  Input,
  Textarea,
  Select,
  Checkbox,
  Label,
  FormError,
  FormField,
  type InputProps,
  type TextareaProps,
  type SelectProps,
  type CheckboxProps,
  type LabelProps,
  type FormErrorProps,
  type FormFieldProps,
} from "./Input";

// Status
export { Badge, type BadgeProps, type BadgeVariant, type BadgeSize } from "./Badge";
