import type {
  BetaInvitationEmailInput,
  EmailResult,
  EmailService,
} from "./types";
import { deliverEmail } from "./deliverEmail";
import { renderBetaInvitationEmail } from "./templates/betaInvitationEmail";

const BETA_INVITATION_SUBJECT =
  "You're invited to the Alliance Command Center beta";

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
};
