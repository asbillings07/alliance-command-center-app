/**
 * Email Domain
 *
 * Transactional email as a replaceable infrastructure concern. The application
 * depends on `emailService` (business intent); the concrete provider lives
 * behind the EmailTransport boundary.
 *
 * @example
 * import { emailService } from "@/app/src/lib/email";
 * await emailService.sendBetaInvitation({ to, invitation });
 */

export { emailService } from "./emailService";
export { isEmailEnabled } from "./isEmailEnabled";
export type {
  EmailStatus,
  EmailResult,
  EmailService,
  EmailTransport,
  EmailContent,
  DeliverEmailRequest,
  EmailMetadata,
  BetaInvitationView,
  BetaInvitationEmailInput,
  AccessRequestConfirmationView,
  AccessRequestConfirmationEmailInput,
} from "./types";
