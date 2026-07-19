import { prisma } from "@/app/src/lib/prisma";
import { emailService, type FeedbackNotificationView } from "@/app/src/lib/email";
import { FEEDBACK_CATEGORY_LABELS } from "@/app/src/lib/feedbackCategory";
import type { FeedbackRecord } from "@/app/src/lib/feedback";
import { extractFeedbackContext } from "./extractFeedbackContext";

/**
 * Notify the operator about a new feedback submission.
 *
 * This is the single "communication" step in the feedback pipeline and the one
 * place to add channels later (Slack, Linear, GitHub). It reads declaratively:
 * extract context -> resolve names -> send. Best-effort by contract: it never
 * throws, so a notification problem can never turn a persisted submission into
 * a user-facing error (ADR-014).
 */
export async function notifyOperator(params: {
  feedback: FeedbackRecord;
  submitterEmail: string;
}): Promise<void> {
  const { feedback, submitterEmail } = params;

  const recipient = resolveOperatorRecipient();
  if (!recipient) {
    // No operator configured (e.g. local dev without env). Persistence already
    // succeeded; there's simply nothing to notify.
    console.warn(
      "[feedback] no operator recipient configured; skipping notification"
    );
    return;
  }

  try {
    const { allianceId, periodId } = extractFeedbackContext(feedback.url);
    const [allianceName, periodLabel] = await Promise.all([
      resolveAllianceName(allianceId),
      resolvePeriodLabel(periodId),
    ]);

    const view: FeedbackNotificationView = {
      referenceId: feedback.id.slice(0, 8),
      categoryLabel: FEEDBACK_CATEGORY_LABELS[feedback.category],
      message: feedback.message,
      submitterEmail,
      url: feedback.url,
      submittedAt: feedback.createdAt,
      allianceName,
      periodLabel,
      appVersion: feedback.appVersion ?? undefined,
      viewport: feedback.viewport ?? undefined,
    };

    await emailService.sendFeedbackNotification({
      to: recipient,
      feedback: view,
      feedbackId: feedback.id,
    });
  } catch (error) {
    console.error("[feedback] operator notification failed", error);
  }
}

/**
 * Where operator notifications are sent. Prefer an explicit
 * FEEDBACK_NOTIFICATION_EMAIL (settable per environment by CI/CD); otherwise
 * fall back to the first configured platform admin email.
 */
function resolveOperatorRecipient(): string | null {
  const explicit = process.env.FEEDBACK_NOTIFICATION_EMAIL?.trim();
  if (explicit) {
    return explicit;
  }
  const firstAdmin = (process.env.PLATFORM_ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim())
    .find((email) => email.length > 0);
  return firstAdmin ?? null;
}

/** Best-effort alliance name lookup; returns undefined if missing/not found. */
async function resolveAllianceName(
  allianceId: string | undefined
): Promise<string | undefined> {
  if (!allianceId) return undefined;
  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
    select: { name: true },
  });
  return alliance?.name;
}

/** Best-effort period label lookup; returns undefined if missing/not found. */
async function resolvePeriodLabel(
  periodId: string | undefined
): Promise<string | undefined> {
  if (!periodId) return undefined;
  const period = await prisma.metricPeriod.findUnique({
    where: { id: periodId },
    select: { name: true },
  });
  return period?.name;
}
