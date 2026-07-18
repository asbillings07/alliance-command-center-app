import type {
  AccessRequestConfirmationEmailInput,
  BetaInvitationEmailInput,
  EmailResult,
  EmailService,
} from "./types";
import { deliverEmail } from "./deliverEmail";
import { renderBetaInvitationEmail } from "./templates/betaInvitationEmail";
import { renderAccessRequestConfirmationEmail } from "./templates/accessRequestConfirmationEmail";

const BETA_INVITATION_SUBJECT =
  "You're invited to the Alliance Command Center beta";

const ACCESS_REQUEST_CONFIRMATION_SUBJECT =
  "Thanks for your interest in Alliance Command Center";

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
};
