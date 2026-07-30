import type { FeedbackTriageStatus } from "@/app/generated/prisma/enums";
import { FEEDBACK_CATEGORY_LABELS } from "@/app/src/lib/feedbackCategory";
import type { FeedbackTriageHistoryItem } from "@/app/src/lib/platform/feedbackInbox";
import { ALL_TRIAGE_STATUSES } from "@/app/src/lib/platform/feedbackInbox";
import type { BadgeVariant } from "@/app/src/components";

export { FEEDBACK_CATEGORY_LABELS, ALL_TRIAGE_STATUSES };

export const TRIAGE_STATUS_LABELS: Record<FeedbackTriageStatus, string> = {
  NEW: "New",
  TRIAGED: "Triaged",
  PLANNED: "Planned",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
};

export const TRIAGE_STATUS_VARIANTS: Record<FeedbackTriageStatus, BadgeVariant> = {
  NEW: "info",
  TRIAGED: "neutral",
  PLANNED: "warning",
  RESOLVED: "success",
  DISMISSED: "neutral",
};

export type ResponseIndicatorState =
  | "unreviewed"
  | "needs_response"
  | "no_response_needed";

export function getResponseIndicatorState(input: {
  hasBeenTriaged: boolean;
  needsResponse: boolean;
}): ResponseIndicatorState {
  if (!input.hasBeenTriaged) {
    return "unreviewed";
  }
  if (input.needsResponse) {
    return "needs_response";
  }
  return "no_response_needed";
}

export const RESPONSE_INDICATOR_LABELS: Record<ResponseIndicatorState, string> = {
  unreviewed: "Unreviewed",
  needs_response: "Needs response",
  no_response_needed: "No response needed",
};

export const RESPONSE_INDICATOR_VARIANTS: Record<
  ResponseIndicatorState,
  BadgeVariant
> = {
  unreviewed: "neutral",
  needs_response: "warning",
  no_response_needed: "success",
};

export function formatHistoryEventChanges(event: FeedbackTriageHistoryItem): string[] {
  const changes: string[] = [];

  if (event.statusChangedTo) {
    changes.push(
      `Status changed to ${TRIAGE_STATUS_LABELS[event.statusChangedTo]}`,
    );
  }

  if (event.noteText) {
    changes.push(`Note: ${event.noteText}`);
  }

  if (event.needsResponseChangedTo !== null) {
    changes.push(
      `Needs response: ${event.needsResponseChangedTo ? "on" : "off"}`,
    );
  }

  if (event.githubIssueUrlChanged) {
    if (event.githubIssueUrlChangedTo) {
      changes.push(`GitHub link set to ${event.githubIssueUrlChangedTo}`);
    } else {
      changes.push("GitHub link cleared");
    }
  }

  return changes;
}

export function formatActorLabel(
  email: string,
  displayName: string | null,
): string {
  return displayName ? `${displayName} (${email})` : email;
}
