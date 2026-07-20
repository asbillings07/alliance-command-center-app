/**
 * Email domain types.
 *
 * These types are provider-agnostic. Nothing here references Resend; the
 * concrete provider lives behind the {@link EmailTransport} boundary.
 */

/**
 * Outcome of an email delivery attempt.
 *
 * - `sent`    delivered to the provider (see `messageId`)
 * - `failed`  the provider rejected the send or errored (see `error`)
 * - `skipped` email is not configured; nothing was sent (dev/CI)
 */
export type EmailStatus = "sent" | "failed" | "skipped";

export type EmailResult = {
  status: EmailStatus;
  /** Provider message id, when the send succeeded. Useful for audit/support. */
  messageId?: string;
  /** Human-readable failure reason, when `status` is "failed". */
  error?: string;
};

/** Optional context attached to a delivery for logging/correlation. */
export type EmailMetadata = {
  invitationId?: string;
  userId?: string;
  accessRequestId?: string;
  feedbackId?: string;
};

/** Rendered email body (HTML + plain text fallback). */
export type EmailContent = {
  html: string;
  text: string;
};

/** A fully rendered message handed to a transport. */
export type DeliverEmailRequest = {
  to: string;
  subject: string;
  html: string;
  text: string;
  metadata?: EmailMetadata;
};

/**
 * A transport delivers an already-rendered message. Implementations own all
 * provider-specific concerns (e.g. talking to Resend) and never throw for
 * delivery failures — they map them onto {@link EmailResult}.
 */
export interface EmailTransport {
  deliver(request: DeliverEmailRequest): Promise<EmailResult>;
}

/**
 * The application-facing email service. Methods express business intent; they
 * build the subject + template and delegate rendering/delivery to the
 * transport layer. Add new methods here as new transactional emails appear.
 */
export interface EmailService {
  sendBetaInvitation(input: BetaInvitationEmailInput): Promise<EmailResult>;
  sendAccessRequestConfirmation(
    input: AccessRequestConfirmationEmailInput
  ): Promise<EmailResult>;
  sendFeedbackNotification(
    input: FeedbackNotificationEmailInput
  ): Promise<EmailResult>;
  sendEmailChangeVerification(
    input: EmailChangeVerificationEmailInput
  ): Promise<EmailResult>;
}

/** View model for the verified email-change verification email. */
export type EmailChangeVerificationView = {
  /** Absolute URL to the confirmation page carrying the single-use token. */
  verifyUrl: string;
  /** When the link stops working, for a clear deadline in the body. */
  expiresAt: Date;
};

export type EmailChangeVerificationEmailInput = {
  /** The NEW address being verified (the message is sent here). */
  to: string;
  verification: EmailChangeVerificationView;
  /** User id, for delivery correlation in logs. */
  userId?: string;
};

/** View model for the beta invitation email. */
export type BetaInvitationView = {
  id: string;
  email: string;
  inviteUrl: string;
  inviteCode: string;
  expiresAt: Date;
};

export type BetaInvitationEmailInput = {
  to: string;
  invitation: BetaInvitationView;
};

/** View model for the access-request confirmation email. */
export type AccessRequestConfirmationView = {
  /** Recipient's name, used for a friendly greeting when available. */
  name?: string;
};

export type AccessRequestConfirmationEmailInput = {
  to: string;
  request: AccessRequestConfirmationView;
  /** Persisted request id, for delivery correlation in logs. */
  accessRequestId?: string;
};

/**
 * View model for the operator feedback notification. Facts come from the
 * persisted record; alliance/period are context resolved by the notifier from
 * the submission URL (may be absent). Optional rows are omitted when empty.
 */
export type FeedbackNotificationView = {
  /** Short, user-facing correlation id (e.g. first 8 chars of the row id). */
  referenceId: string;
  /** Human-friendly category label, e.g. "Something was confusing". */
  categoryLabel: string;
  message: string;
  submitterEmail: string;
  url: string;
  submittedAt: Date;
  allianceName?: string;
  periodLabel?: string;
  appVersion?: string;
  viewport?: string;
};

export type FeedbackNotificationEmailInput = {
  to: string;
  feedback: FeedbackNotificationView;
  /** Persisted feedback id, for delivery correlation in logs and subject. */
  feedbackId?: string;
};
