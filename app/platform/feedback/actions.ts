"use server";

import { revalidatePath } from "next/cache";
import type { FeedbackTriageStatus } from "@/app/generated/prisma/enums";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import {
  recordFeedbackTriageEvent,
  type StaleConflictPayload,
} from "@/app/src/lib/feedbackTriage";
import {
  listFeedbackTriageHistory,
  type FeedbackTriageHistoryItem,
} from "@/app/src/lib/platform/feedbackInbox";

export type RecordFeedbackTriageEventInput = {
  status?: FeedbackTriageStatus;
  note?: string;
  needsResponse?: boolean;
  /** undefined = untouched; null = explicit clear; string = set. */
  githubIssueUrl?: string | null;
};

export type RecordFeedbackTriageEventResult =
  | { success: true }
  | { success: false; error: string; conflict?: StaleConflictPayload };

export type FeedbackTriageHistoryResult =
  | {
      success: true;
      items: FeedbackTriageHistoryItem[];
      total: number;
      page: number;
      pageSize: number;
    }
  | { success: false; error: string };

/**
 * Record an operator triage action against a feedback item (#176).
 */
export async function recordFeedbackTriageEventAction(
  feedbackId: string,
  lastSeenStateRevision: number,
  changes: RecordFeedbackTriageEventInput,
): Promise<RecordFeedbackTriageEventResult> {
  const session = await requirePlatformAdmin();

  if (!feedbackId) {
    return { success: false, error: "Feedback not found" };
  }

  const result = await recordFeedbackTriageEvent(
    feedbackId,
    session.id,
    changes,
    lastSeenStateRevision,
  );

  if (result.ok) {
    revalidatePath("/platform/feedback");
    return { success: true };
  }

  if (result.code === "STALE_CONFLICT") {
    return {
      success: false,
      error:
        "Someone else updated this item while you were editing. Review the current state below, then resubmit if you still want your change.",
      conflict: result.conflict,
    };
  }

  if (result.code === "NO_CHANGES") {
    return { success: false, error: "No changes to save" };
  }

  return { success: false, error: result.message };
}

/**
 * Load paginated triage event history for one feedback item.
 */
export async function fetchFeedbackTriageHistoryAction(
  feedbackId: string,
  page = 1,
  pageSize = 10,
): Promise<FeedbackTriageHistoryResult> {
  await requirePlatformAdmin();

  if (!feedbackId) {
    return { success: false, error: "Feedback not found" };
  }

  try {
    const result = await listFeedbackTriageHistory(feedbackId, page, pageSize);
    return {
      success: true,
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
    };
  } catch (error) {
    return {
      success: false,
      error:
        error instanceof Error
          ? error.message
          : "Failed to load triage history",
    };
  }
}
