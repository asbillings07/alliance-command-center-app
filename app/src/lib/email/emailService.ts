import { createElement } from "react";
import type {
  BetaInvitationEmailInput,
  EmailResult,
  EmailService,
} from "./types";
import { deliverEmail } from "./deliverEmail";
import { BetaInvitationEmail } from "./templates/BetaInvitationEmail";

const BETA_INVITATION_SUBJECT = "You're invited to AllianceHQ Beta";

/**
 * Application-facing email service. Each method expresses a business email,
 * builds the subject + template, and delegates rendering/delivery to
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
      react: createElement(BetaInvitationEmail, { invitation }),
      metadata: { invitationId: invitation.id },
    });
  },
};
