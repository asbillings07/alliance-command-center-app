import { prisma } from "./prisma";
import type { FeedbackCategory } from "@/app/generated/prisma/enums";

/**
 * Feedback domain service.
 *
 * Persists in-app feedback from an authenticated user. This service has exactly
 * one responsibility: store the feedback record. It knows nothing about email,
 * Slack, or any other notification channel (ADR-014) — the action layer owns
 * notifying interested parties after persistence.
 *
 * The row stores facts (message + client/context metadata). Human-friendly
 * context like the alliance or period is derived from the URL when building the
 * notification, not stored here, keeping the schema lean.
 */

export type CreateFeedbackInput = {
  userId: string;
  category: FeedbackCategory;
  message: string;
  url: string;
  userAgent?: string | null;
  viewport?: string | null;
  appVersion?: string | null;
};

export type FeedbackRecord = {
  id: string;
  userId: string;
  category: FeedbackCategory;
  message: string;
  url: string;
  userAgent: string | null;
  viewport: string | null;
  appVersion: string | null;
  createdAt: Date;
};

/** Normalize an optional free-text field: trim, and treat empty as absent. */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Persist a feedback submission. The caller is responsible for authenticating
 * the user and validating the required fields (category, message); this service
 * applies light normalization and stores the record.
 */
export async function createFeedback(
  input: CreateFeedbackInput
): Promise<FeedbackRecord> {
  return prisma.feedback.create({
    data: {
      userId: input.userId,
      category: input.category,
      message: input.message.trim(),
      url: input.url.trim(),
      userAgent: optionalText(input.userAgent),
      viewport: optionalText(input.viewport),
      appVersion: optionalText(input.appVersion),
    },
  });
}
