import type { BetaInvitationView, EmailContent } from "../types";

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

function formatExpiration(date: Date): string {
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/**
 * Render the beta invitation email to HTML + plain text.
 *
 * Hand-rolled, inline-styled, table-free markup kept deliberately simple so it
 * degrades gracefully across email clients without a template framework. All
 * interpolated values are HTML-escaped.
 */
export function renderBetaInvitationEmail(
  invitation: BetaInvitationView
): EmailContent {
  const url = escapeHtml(invitation.inviteUrl);
  const code = escapeHtml(invitation.inviteCode);
  const expires = escapeHtml(formatExpiration(invitation.expiresAt));
  const support = escapeHtml(SUPPORT_EMAIL);

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Alliance Command Center</title>
  </head>
  <body style="margin:0;padding:24px 0;background-color:#0F172A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">You're invited to the Alliance Command Center beta.</div>
    <div style="max-width:480px;margin:0 auto;padding:32px;background-color:#111827;border:1px solid #374151;border-radius:12px;">
      <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#F9FAFB;text-align:center;">Alliance Command Center</h1>

      <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#E5E7EB;">Hi,</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#E5E7EB;">
        You've been invited to the Alliance Command Center beta &mdash; the operating system for alliance leadership. Click below to accept your invitation and set up your alliance workspace.
      </p>

      <div style="margin:24px 0;text-align:center;">
        <a href="${url}" style="display:inline-block;padding:12px 24px;background-color:#3B82F6;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">Accept Invitation</a>
      </div>

      <p style="margin:16px 0 4px;font-size:13px;line-height:20px;color:#9CA3AF;">Or paste this link into your browser:</p>
      <a href="${url}" style="font-size:13px;color:#60A5FA;word-break:break-all;">${url}</a>

      <p style="margin:16px 0 4px;font-size:13px;line-height:20px;color:#9CA3AF;">Prefer to enter a code? Use this invitation code at the redeem page:</p>
      <p style="margin:4px 0 0;font-size:20px;font-weight:700;letter-spacing:2px;color:#F9FAFB;">${code}</p>

      <hr style="margin:24px 0;border:none;border-top:1px solid #374151;" />

      <p style="margin:0 0 4px;font-size:12px;line-height:18px;color:#9CA3AF;">This invitation expires on ${expires}.</p>
      <p style="margin:0 0 4px;font-size:12px;line-height:18px;color:#9CA3AF;">
        Questions? Contact us at <a href="mailto:${support}" style="color:#60A5FA;">${support}</a>.
      </p>
    </div>
  </body>
</html>`;

  const text = [
    "Alliance Command Center",
    "",
    "Hi,",
    "",
    "You've been invited to the Alliance Command Center beta - the operating system for alliance leadership. Accept your invitation and set up your alliance workspace using the link below:",
    "",
    invitation.inviteUrl,
    "",
    `Prefer to enter a code? Use this invitation code at the redeem page: ${invitation.inviteCode}`,
    "",
    `This invitation expires on ${formatExpiration(invitation.expiresAt)}.`,
    `Questions? Contact us at ${SUPPORT_EMAIL}.`,
    "",
  ].join("\n");

  return { html, text };
}
