import { AccessRequestQueueRetryButton } from "./AccessRequestQueueRetryButton";

/**
 * Mirrors FeedbackInboxUnavailable (app/platform/feedback/FeedbackUnavailable.tsx)
 * — a thrown listAccessRequestsForTriage() otherwise escapes this route
 * entirely into Next.js's generic error boundary instead of a scoped,
 * recoverable message (review feedback on PR #260: "the queue's initial
 * read has no deliberate error state").
 */
export function AccessRequestQueueUnavailable() {
  return (
    <div
      role="alert"
      data-testid="access-request-queue-unavailable"
      className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-6 text-center space-y-3"
    >
      <h2 className="text-lg font-semibold text-text-primary">
        Access request queue unavailable
      </h2>
      <p className="text-sm text-text-secondary">
        We couldn&apos;t load access requests right now. The rest of the Platform Console is still
        available.
      </p>
      <AccessRequestQueueRetryButton />
    </div>
  );
}
