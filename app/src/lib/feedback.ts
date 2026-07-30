import { prisma } from "./prisma";
import type { FeedbackCategory } from "@/app/generated/prisma/enums";
import { extractFeedbackContext } from "./extractFeedbackContext";

/**
 * Feedback domain service.
 *
 * Persists in-app feedback from an authenticated user. This service has exactly
 * one responsibility: store the feedback record (plus its initial triage
 * projection). It knows nothing about email, Slack, or any other notification
 * channel (ADR-014) — the action layer owns notifying interested parties after
 * persistence.
 *
 * Submitter identity is loaded from the User row inside the transaction
 * (#176 decision 4); alliance context is derived from the URL via
 * extractFeedbackContext.
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
  userId: string | null;
  submitterEmail: string;
  submitterDisplayName: string | null;
  category: FeedbackCategory;
  message: string;
  url: string;
  userAgent: string | null;
  viewport: string | null;
  appVersion: string | null;
  allianceId: string | null;
  createdAt: Date;
};

/** Normalize an optional free-text field: trim, and treat empty as absent. */
function optionalText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Persist a feedback submission. Loads submitter identity from the User row
 * inside the transaction and creates the initial FeedbackTriage projection.
 */
export async function createFeedback(
  input: CreateFeedbackInput
): Promise<FeedbackRecord> {
  const trimmedUrl = input.url.trim();
  const { allianceId } = extractFeedbackContext(trimmedUrl);

  return prisma.$transaction(async (tx) => {
    const user = await tx.user.findUnique({
      where: { id: input.userId },
      select: { email: true, displayName: true },
    });
    if (!user) {
      throw new Error(`Cannot create feedback: user ${input.userId} not found`);
    }

    const feedback = await tx.feedback.create({
      data: {
        userId: input.userId,
        submitterEmail: user.email,
        submitterDisplayName: user.displayName,
        category: input.category,
        message: input.message.trim(),
        url: trimmedUrl,
        userAgent: optionalText(input.userAgent),
        viewport: optionalText(input.viewport),
        appVersion: optionalText(input.appVersion),
        allianceId: allianceId ?? null,
        triage: {
          create: {
            status: "NEW",
            needsResponse: true,
            stateRevision: 0,
          },
        },
      },
    });

    return feedback;
  });
}
