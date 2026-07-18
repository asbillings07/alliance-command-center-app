import type { EmailContent, EmailMetadata, EmailResult } from "./types";
import { transport } from "./transport";

export type DeliverEmailInput = {
  to: string;
  subject: string;
  content: EmailContent;
  metadata?: EmailMetadata;
};

/**
 * Hand a rendered message to the selected transport. This is the single
 * low-level delivery primitive: it delegates delivery and returns a canonical
 * {@link EmailResult}. Business intent lives in the email service; rendering
 * lives in the templates.
 *
 * Never throws: an unexpected transport failure is mapped onto a `failed`
 * result so callers keep the non-blocking guarantee (a persisted invitation is
 * never invalidated by an email problem).
 */
export async function deliverEmail({
  to,
  subject,
  content,
  metadata,
}: DeliverEmailInput): Promise<EmailResult> {
  try {
    return await transport.deliver({
      to,
      subject,
      html: content.html,
      text: content.text,
      metadata,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("[email] deliverEmail failed to deliver", {
      error: err,
      to,
      subject,
      metadata,
    });
    return { status: "failed", error: message };
  }
}
