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
}

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
