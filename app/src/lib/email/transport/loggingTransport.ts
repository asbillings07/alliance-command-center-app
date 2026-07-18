import { isProduction } from "../../env";
import type { DeliverEmailRequest, EmailResult, EmailTransport } from "../types";

/**
 * Development/CI transport. Logs the rendered message (including metadata) and
 * reports `skipped` so callers can behave identically whether or not a real
 * provider is configured. No email leaves the machine.
 *
 * The rendered body can contain effectively-secret data (invite tokens/codes),
 * so it is only logged outside production. If email is ever accidentally
 * disabled in a production-like environment, we log that it was skipped without
 * leaking the body into server logs.
 */
export class LoggingTransport implements EmailTransport {
  async deliver(request: DeliverEmailRequest): Promise<EmailResult> {
    if (isProduction()) {
      console.warn(
        "[email] (skipped - email not configured in production; body redacted)",
        {
          to: request.to,
          subject: request.subject,
          metadata: request.metadata,
        }
      );
    } else {
      console.info("[email] (skipped - email not configured)", {
        to: request.to,
        subject: request.subject,
        metadata: request.metadata,
        text: request.text,
      });
    }
    return { status: "skipped" };
  }
}
