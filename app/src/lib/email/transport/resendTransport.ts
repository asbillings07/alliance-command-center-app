import { Resend } from "resend";
import type { DeliverEmailRequest, EmailResult, EmailTransport } from "../types";

/**
 * Resend implementation of {@link EmailTransport}.
 *
 * This is the only place in the codebase that talks to Resend. It maps the
 * provider response onto our canonical {@link EmailResult} and never throws for
 * delivery failures, so a provider outage can't invalidate a caller's work.
 */
export class ResendTransport implements EmailTransport {
  private readonly client: Resend;
  private readonly from: string;

  constructor(apiKey: string, from: string) {
    this.client = new Resend(apiKey);
    this.from = from;
  }

  async deliver(request: DeliverEmailRequest): Promise<EmailResult> {
    try {
      const { data, error } = await this.client.emails.send({
        from: this.from,
        to: request.to,
        subject: request.subject,
        html: request.html,
        text: request.text,
        replyTo: request.replyTo,
      });

      if (error) {
        console.error("[email] Resend rejected send", {
          error,
          to: request.to,
          subject: request.subject,
          metadata: request.metadata,
        });
        return { status: "failed", error: error.message };
      }

      return { status: "sent", messageId: data?.id };
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error("[email] Resend send threw", {
        error: err,
        to: request.to,
        subject: request.subject,
        metadata: request.metadata,
      });
      return { status: "failed", error: message };
    }
  }
}
