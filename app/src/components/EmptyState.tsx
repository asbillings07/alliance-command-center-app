import { ReactNode } from "react";

/**
 * EmptyState Props
 *
 * Implements the Empty State Pattern from the design system:
 * Icon → Title → Description → Action
 */
export type EmptyStateProps = {
  /** Icon to display (use 24x24 or w-6 h-6) */
  icon?: ReactNode;
  /** Title text */
  title: string;
  /** Description text explaining what to do */
  description?: string;
  /** Primary action (usually a Button) */
  action?: ReactNode;
  /** Secondary action (link or ghost button) */
  secondaryAction?: ReactNode;
};

/**
 * EmptyState Component
 *
 * Displays a consistent empty state across the application.
 * Every empty state should guide the user toward the next step.
 *
 * @example
 * <EmptyState
 *   icon={<UsersIcon className="w-6 h-6" />}
 *   title="No members yet"
 *   description="Import your roster or add members manually to get started."
 *   action={<Button variant="primary">Import Members</Button>}
 *   secondaryAction={<Button variant="link" href="/docs/import">Learn more</Button>}
 * />
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  secondaryAction,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      {icon && (
        <div className="mb-4 p-3 bg-surface-secondary rounded-full text-text-muted">
          {icon}
        </div>
      )}

      <h3 className="text-lg font-semibold text-text-primary mb-2">{title}</h3>

      {description && (
        <p className="text-sm text-text-muted max-w-md mb-6">{description}</p>
      )}

      {(action || secondaryAction) && (
        <div className="flex flex-col sm:flex-row items-center gap-3">
          {action}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

/**
 * EmptyStateCard - EmptyState wrapped in a Card
 *
 * Convenience component for empty states that should appear in a card container.
 *
 * @example
 * <EmptyStateCard
 *   icon={<InboxIcon className="w-6 h-6" />}
 *   title="No invitations"
 *   description="Send invitations to grow your leadership team."
 *   action={<Button variant="primary">Send Invitation</Button>}
 * />
 */
export function EmptyStateCard(props: EmptyStateProps) {
  return (
    <div className="bg-surface border border-border rounded-lg">
      <EmptyState {...props} />
    </div>
  );
}
