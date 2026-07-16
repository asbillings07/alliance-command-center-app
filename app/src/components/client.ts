"use client";

/**
 * Alliance Command Center Design System — Client Components
 *
 * Interactive components that rely on client-only React features (refs, hooks,
 * event handlers). Import these from Client Components:
 *
 * @example
 * "use client";
 * import { Button, Input, FormField } from "@/app/src/components/client";
 *
 * Server/shared presentational components (PageLayout, Card, Badge, etc.) live
 * in the sibling "@/app/src/components" entrypoint.
 */

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
