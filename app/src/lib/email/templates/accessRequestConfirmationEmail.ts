import type { AccessRequestConfirmationView, EmailContent } from "../types";

const SUPPORT_EMAIL = "support@alliancehq.app";

/** Escape a value for safe interpolation into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Render the access-request confirmation email to HTML + plain text.
 *
 * Hand-rolled, inline-styled, table-free markup kept deliberately simple so it
 * degrades gracefully across email clients without a template framework. All
 * interpolated values are HTML-escaped. This email only confirms receipt of
 * interest — it is not an invitation and grants no access.
 */
export function renderAccessRequestConfirmationEmail(
  request: AccessRequestConfirmationView
): EmailContent {
  const name = request.name?.trim();
  const greetingName = name ? escapeHtml(name) : null;
  const support = escapeHtml(SUPPORT_EMAIL);

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Alliance Command Center</title>
  </head>
  <body style="margin:0;padding:24px 0;background-color:#0F172A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Thanks for your interest in the Alliance Command Center beta.</div>
    <div style="max-width:480px;margin:0 auto;padding:32px;background-color:#111827;border:1px solid #374151;border-radius:12px;">
      <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#F9FAFB;text-align:center;">Alliance Command Center</h1>

      <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#E5E7EB;">${
        greetingName ? `Hi ${greetingName},` : "Hi,"
      }</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#E5E7EB;">
        Thanks for your interest in Alliance Command Center &mdash; the operating system for alliance leadership. We've received your request to join the private beta.
      </p>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#E5E7EB;">
        The beta is invite-only while we onboard alliances gradually. We review every request and will reach out by email if we're able to invite you.
      </p>

      <hr style="margin:24px 0;border:none;border-top:1px solid #374151;" />

      <p style="margin:0 0 4px;font-size:12px;line-height:18px;color:#9CA3AF;">You don't need to do anything else &mdash; there's no account yet, and this message is just a confirmation that we received your request.</p>
      <p style="margin:0 0 4px;font-size:12px;line-height:18px;color:#9CA3AF;">
        Questions? Contact us at <a href="mailto:${support}" style="color:#60A5FA;">${support}</a>.
      </p>
    </div>
  </body>
</html>`;

  const text = [
    "Alliance Command Center",
    "",
    greetingName ? `Hi ${name},` : "Hi,",
    "",
    "Thanks for your interest in Alliance Command Center - the operating system for alliance leadership. We've received your request to join the private beta.",
    "",
    "The beta is invite-only while we onboard alliances gradually. We review every request and will reach out by email if we're able to invite you.",
    "",
    "You don't need to do anything else - there's no account yet, and this message is just a confirmation that we received your request.",
    `Questions? Contact us at ${SUPPORT_EMAIL}.`,
    "",
  ].join("\n");

  return { html, text };
}
