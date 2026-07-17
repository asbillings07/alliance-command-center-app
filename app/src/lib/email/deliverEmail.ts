import type { ReactElement } from "react";
import { render } from "@react-email/render";
import type { EmailMetadata, EmailResult } from "./types";
import { transport } from "./transport";

export type DeliverEmailInput = {
  to: string;
  subject: string;
  react: ReactElement;
  metadata?: EmailMetadata;
};

/**
 * Render a React Email component to HTML + plain text and hand it to the
 * selected transport. This is the single low-level delivery primitive: it
 * coordinates rendering, delegates delivery, and returns a canonical
 * {@link EmailResult}. Business intent lives in the email service, not here.
 */
export async function deliverEmail({
  to,
  subject,
  react,
  metadata,
}: DeliverEmailInput): Promise<EmailResult> {
  const [html, text] = await Promise.all([
    render(react),
    render(react, { plainText: true }),
  ]);

  return transport.deliver({ to, subject, html, text, metadata });
}
