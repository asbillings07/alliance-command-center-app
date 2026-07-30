import { FeedbackInboxRetryButton } from "./FeedbackRetryButton";

export function FeedbackInboxUnavailable() {
  return (
    <div
      role="alert"
      data-testid="feedback-inbox-unavailable"
      className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-6 text-center space-y-3"
    >
      <h2 className="text-lg font-semibold text-text-primary">
        Feedback inbox unavailable
      </h2>
      <p className="text-sm text-text-secondary">
        We couldn&apos;t load feedback items right now. The rest of the Platform
        Console is still available.
      </p>
      <FeedbackInboxRetryButton />
    </div>
  );
}
