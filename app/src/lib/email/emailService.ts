import type {
  BetaInvitationEmailInput,
  EmailResult,
  EmailService,
  PasswordResetEmailInput,
} from "./types";
import { deliverEmail } from "./deliverEmail";
import { renderBetaInvitationEmail } from "./templates/betaInvitationEmail";
import { renderPasswordResetEmail } from "./templates/passwordResetEmail";

const BETA_INVITATION_SUBJECT =
  "You're invited to the Alliance Command Center beta";

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
      metadata: { invitationId: invitation.id },
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
