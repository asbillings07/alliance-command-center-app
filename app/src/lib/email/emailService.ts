import type {
  AccessRequestConfirmationEmailInput,
  BetaInvitationEmailInput,
  EmailChangeVerificationEmailInput,
  EmailResult,
  EmailService,
  FeedbackNotificationEmailInput,
  PasswordResetEmailInput,
} from "./types";
import { deliverEmail } from "./deliverEmail";
import { renderBetaInvitationEmail } from "./templates/betaInvitationEmail";
import { renderAccessRequestConfirmationEmail } from "./templates/accessRequestConfirmationEmail";
import { renderFeedbackNotificationEmail } from "./templates/feedbackNotificationEmail";
import { renderEmailChangeVerificationEmail } from "./templates/emailChangeVerificationEmail";
import { renderPasswordResetEmail } from "./templates/passwordResetEmail";

const DEFAULT_REPLY_TO = "support@alliancehq.app";

const BETA_INVITATION_SUBJECT =
  "You're invited to the Alliance Command Center beta";

const ACCESS_REQUEST_CONFIRMATION_SUBJECT =
  "Thanks for your interest in Alliance Command Center";

const EMAIL_CHANGE_VERIFICATION_SUBJECT =
  "Confirm your new Alliance Command Center email";

const PASSWORD_RESET_SUBJECT = "Reset your Alliance Command Center password";

/**
 * Application-facing email service. Each method expresses a business email,
 * builds the subject + rendered content, and delegates delivery to
 * {@link deliverEmail}. The rest of the app depends on this interface, never on
 * a provider.
 */
export const emailService: EmailService = {
  async sendBetaInvitation({
    to,
    invitation,
  }: BetaInvitationEmailInput): Promise<EmailResult> {
    return deliverEmail({
      to,
      subject: BETA_INVITATION_SUBJECT,
      content: renderBetaInvitationEmail(invitation),
      replyTo: DEFAULT_REPLY_TO,
      metadata: { invitationId: invitation.id },
    });
  },

  async sendAccessRequestConfirmation({
    to,
    request,
    accessRequestId,
  }: AccessRequestConfirmationEmailInput): Promise<EmailResult> {
    return deliverEmail({
      to,
      subject: ACCESS_REQUEST_CONFIRMATION_SUBJECT,
      content: renderAccessRequestConfirmationEmail(request),
      metadata: accessRequestId ? { accessRequestId } : undefined,
    });
  },

  async sendFeedbackNotification({
    to,
    feedback,
    feedbackId,
  }: FeedbackNotificationEmailInput): Promise<EmailResult> {
    return deliverEmail({
      to,
      // The reference id makes each submission easy to find and lets a user's
      // follow-up ("I sent feedback yesterday") map to a row and this email.
      subject: `[AllianceHQ Feedback #${feedback.referenceId}]`,
      content: renderFeedbackNotificationEmail(feedback),
      metadata: feedbackId ? { feedbackId } : undefined,
    });
  },

  async sendEmailChangeVerification({
    to,
    verification,
    userId,
  }: EmailChangeVerificationEmailInput): Promise<EmailResult> {
    return deliverEmail({
      to,
      subject: EMAIL_CHANGE_VERIFICATION_SUBJECT,
      content: renderEmailChangeVerificationEmail(verification),
      metadata: userId ? { userId } : undefined,
    });
  },

  async sendPasswordReset({
    to,
    reset,
    userId,
  }: PasswordResetEmailInput): Promise<EmailResult> {
    return deliverEmail({
      to,
      subject: PASSWORD_RESET_SUBJECT,
      content: renderPasswordResetEmail(reset),
      metadata: userId ? { userId } : undefined,
    });
  },
};
