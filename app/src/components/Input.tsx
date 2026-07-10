import {
  InputHTMLAttributes,
  TextareaHTMLAttributes,
  SelectHTMLAttributes,
  LabelHTMLAttributes,
  forwardRef,
  ReactNode,
  cloneElement,
  isValidElement,
  useId,
} from "react";

/**
 * Shared input styling following the design system
 */
const inputBaseClasses =
  "w-full px-4 py-2 bg-surface-secondary border border-border rounded-lg text-text-primary placeholder-text-muted transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed";

const inputErrorClasses =
  "border-danger focus:ring-danger";

// ============================================================
// Label
// ============================================================

export type LabelProps = {
  /** Whether the field is required */
  required?: boolean;
  children: ReactNode;
} & LabelHTMLAttributes<HTMLLabelElement>;

/**
 * Label Component
 *
 * Consistent label styling for form fields.
 */
export function Label({ required, children, ...props }: LabelProps) {
  return (
    <label
      className="block text-sm font-medium text-text-secondary mb-2"
      {...props}
    >
      {children}
      {required && <span className="text-danger ml-1">*</span>}
    </label>
  );
}

// ============================================================
// FormError
// ============================================================

export type FormErrorProps = {
  children: ReactNode;
};

/**
 * FormError Component
 *
 * Displays form validation errors.
 */
export function FormError({ children }: FormErrorProps) {
  if (!children) return null;

  return (
    <p className="mt-1 text-sm text-danger">{children}</p>
  );
}

// ============================================================
// Input
// ============================================================

export type InputProps = {
  /** Error state */
  error?: boolean;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className">;

/**
 * Input Component
 *
 * Text input following the design system.
 *
 * @example
 * <Label htmlFor="email" required>Email</Label>
 * <Input
 *   id="email"
 *   name="email"
 *   type="email"
 *   placeholder="you@example.com"
 *   error={!!errors.email}
 * />
 * <FormError>{errors.email}</FormError>
 */
export const Input = forwardRef<HTMLInputElement, InputProps>(
  function Input({ error, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={`${inputBaseClasses} ${error ? inputErrorClasses : ""}`}
        {...props}
      />
    );
  }
);

// ============================================================
// Textarea
// ============================================================

export type TextareaProps = {
  /** Error state */
  error?: boolean;
  /** Number of visible rows */
  rows?: number;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className">;

/**
 * Textarea Component
 *
 * Multi-line text input following the design system.
 *
 * @example
 * <Label htmlFor="notes">Notes</Label>
 * <Textarea
 *   id="notes"
 *   name="notes"
 *   rows={4}
 *   placeholder="Enter notes..."
 * />
 */
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea({ error, rows = 3, ...props }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        className={`${inputBaseClasses} resize-none ${error ? inputErrorClasses : ""}`}
        {...props}
      />
    );
  }
);

// ============================================================
// Select
// ============================================================

export type SelectProps = {
  /** Error state */
  error?: boolean;
  children: ReactNode;
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, "className">;

/**
 * Select Component
 *
 * Dropdown select following the design system.
 *
 * @example
 * <Label htmlFor="role">Role</Label>
 * <Select id="role" name="role">
 *   <option value="ADMIN">Admin</option>
 *   <option value="LEADER">Leader</option>
 *   <option value="VIEWER">Viewer</option>
 * </Select>
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ error, children, ...props }, ref) {
    return (
      <select
        ref={ref}
        className={`${inputBaseClasses} cursor-pointer ${error ? inputErrorClasses : ""}`}
        {...props}
      >
        {children}
      </select>
    );
  }
);

// ============================================================
// Checkbox
// ============================================================

export type CheckboxProps = {
  /** Label text */
  label: string;
} & Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type">;

/**
 * Checkbox Component
 *
 * Checkbox with integrated label following the design system.
 *
 * @example
 * <Checkbox
 *   id="remember"
 *   name="remember"
 *   label="Remember me"
 * />
 */
export const Checkbox = forwardRef<HTMLInputElement, CheckboxProps>(
  function Checkbox({ label, id, ...props }, ref) {
    return (
      <div className="flex items-center gap-2">
        <input
          ref={ref}
          type="checkbox"
          id={id}
          className="h-4 w-4 rounded border-border bg-surface-secondary text-primary focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-background"
          {...props}
        />
        <label htmlFor={id} className="text-sm text-text-secondary cursor-pointer">
          {label}
        </label>
      </div>
    );
  }
);

// ============================================================
// FormField (convenience wrapper)
// ============================================================

export type FormFieldProps = {
  /** Field label */
  label: string;
  /** Whether the field is required */
  required?: boolean;
  /** Error message */
  error?: string;
  /** Help text */
  help?: string;
  /** The form control */
  children: ReactNode;
};

/**
 * FormField Component
 *
 * Convenience wrapper that combines Label, input, and FormError.
 * Automatically associates the label with the input for accessibility.
 *
 * @example
 * <FormField label="Email" required error={errors.email}>
 *   <Input name="email" type="email" error={!!errors.email} />
 * </FormField>
 */
export function FormField({
  label,
  required,
  error,
  help,
  children,
}: FormFieldProps) {
  const generatedId = useId();

  // Get the existing id from the child if it has one
  const existingId =
    isValidElement(children) &&
    typeof children.props === "object" &&
    children.props !== null &&
    "id" in children.props
      ? (children.props as { id?: string }).id
      : undefined;

  const inputId = existingId || generatedId;

  // Clone the child element to add the id prop if it's a valid element
  const childWithId = isValidElement(children)
    ? cloneElement(children, { id: inputId } as Record<string, unknown>)
    : children;

  return (
    <div>
      <Label htmlFor={inputId} required={required}>
        {label}
      </Label>
      {childWithId}
      {help && !error && (
        <p className="mt-1 text-sm text-text-muted">{help}</p>
      )}
      <FormError>{error}</FormError>
    </div>
  );
}
