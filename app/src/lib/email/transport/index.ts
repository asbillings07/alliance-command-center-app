import type { EmailTransport } from "../types";
import { isEmailEnabled } from "../isEmailEnabled";
import { ResendTransport } from "./resendTransport";
import { LoggingTransport } from "./loggingTransport";

/**
 * Select the transport for this deployment: Resend when configured, otherwise
 * a logging no-op. Callers never branch on NODE_ENV or env vars themselves.
 */
export function createEmailTransport(): EmailTransport {
  if (isEmailEnabled()) {
    return new ResendTransport(
      process.env.RESEND_API_KEY as string,
      process.env.EMAIL_FROM as string,
    );
  }
  return new LoggingTransport();
}

/**
 * Module-level singleton so the Resend client is constructed once per process
 * rather than per send.
 */
export const transport: EmailTransport = createEmailTransport();
