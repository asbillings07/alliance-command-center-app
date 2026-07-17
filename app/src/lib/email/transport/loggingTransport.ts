import type { DeliverEmailRequest, EmailResult, EmailTransport } from "../types";

/**
 * Development/CI transport. Logs the rendered message (including metadata) and
 * reports `skipped` so callers can behave identically whether or not a real
 * provider is configured. No email leaves the machine.
 */
export class LoggingTransport implements EmailTransport {
  async deliver(request: DeliverEmailRequest): Promise<EmailResult> {
    console.info("[email] (skipped - email not configured)", {
      to: request.to,
      subject: request.subject,
      metadata: request.metadata,
      text: request.text,
    });
    return { status: "skipped" };
  }
}
