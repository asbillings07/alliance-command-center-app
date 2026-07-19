"use server";

import { headers } from "next/headers";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { createFeedback } from "@/app/src/lib/feedback";
import { isFeedbackCategory } from "@/app/src/lib/feedbackCategory";
import { notifyOperator } from "./notifyOperator";

export type SubmitFeedbackState = {
  status: "idle" | "success" | "error";
  error: string | null;
  /** Short reference the UI shows on success ("Ref #abcd1234"). */
  feedbackId?: string;
};

const MAX_MESSAGE_LENGTH = 2000;
const MAX_URL_LENGTH = 512;

/**
 * The URL is a client-supplied hint used only for operator context. Accept it
 * only as an internal, root-relative path ("/...") and clamp its length;
 * anything else (absolute URLs, junk, empty) is normalized away rather than
 * persisted, so it can't mislead operator follow-up.
 */
function normalizeInternalPath(value: string | undefined): string {
  const trimmed = value?.trim() ?? "";
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return "";
  }
  return trimmed.slice(0, MAX_URL_LENGTH);
}

/**
 * Submit in-app feedback.
 *
 * Thin orchestrator: authenticate -> validate -> persist -> notify -> return.
 * The domain service owns persistence; the notifier owns communication. Email
 * is best-effort and never fails the submission (ADR-014): the row is the
 * source of truth.
 */
export async function submitFeedback(
  _prevState: SubmitFeedbackState,
  formData: FormData
): Promise<SubmitFeedbackState> {
  const { id: userId, email } = await requireAuth();

  const category = formData.get("category")?.toString() ?? "";
  const message = formData.get("message")?.toString().trim() ?? "";
  const url = normalizeInternalPath(formData.get("url")?.toString());
  const viewport = formData.get("viewport")?.toString();
  const appVersion = formData.get("appVersion")?.toString();

  if (!isFeedbackCategory(category)) {
    return { status: "error", error: "Please choose what your feedback is about." };
  }
  if (!message) {
    return { status: "error", error: "Please enter a message." };
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return {
      status: "error",
      error: `Please keep your message under ${MAX_MESSAGE_LENGTH} characters.`,
    };
  }

  // Server-derived so the client never asserts identity or spoofs the agent.
  const userAgent = (await headers()).get("user-agent");

  let feedback;
  try {
    feedback = await createFeedback({
      userId,
      category,
      message,
      url,
      userAgent,
      viewport,
      appVersion,
    });
  } catch (error) {
    console.error("[feedback] failed to persist feedback", error);
    return {
      status: "error",
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // Best-effort operator notification. notifyOperator never throws, but guard
  // anyway so a notification problem can never surface as a user error.
  try {
    await notifyOperator({ feedback, submitterEmail: email });
  } catch (error) {
    console.error("[feedback] operator notification failed", error);
  }

  return { status: "success", error: null, feedbackId: feedback.id };
}
