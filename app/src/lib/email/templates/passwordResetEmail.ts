import type { EmailContent, PasswordResetView } from "../types";

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
  // Pin to UTC so the same timestamp renders the same time regardless of the
  // server's locale/time zone, and label it.
  return `${date.toLocaleString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  })} (UTC)`;
}

/**
 * Render the password reset email to HTML + plain text.
 *
 * Hand-rolled, inline-styled markup mirroring the beta invitation email so the
 * two stay visually consistent without a template framework. All interpolated
 * values are HTML-escaped.
 */
export function renderPasswordResetEmail(reset: PasswordResetView): EmailContent {
  const url = escapeHtml(reset.resetUrl);
  const expires = escapeHtml(formatExpiration(reset.expiresAt));
  const support = escapeHtml(SUPPORT_EMAIL);

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Reset your password</title>
  </head>
  <body style="margin:0;padding:24px 0;background-color:#0F172A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">Reset your Alliance Command Center password.</div>
    <div style="max-width:480px;margin:0 auto;padding:32px;background-color:#111827;border:1px solid #374151;border-radius:12px;">
      <h1 style="margin:0 0 24px;font-size:22px;font-weight:700;color:#F9FAFB;text-align:center;">Alliance Command Center</h1>

      <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#E5E7EB;">Hi,</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:24px;color:#E5E7EB;">
        We received a request to reset your Alliance Command Center password. Click below to choose a new one.
      </p>

      <div style="margin:24px 0;text-align:center;">
        <a href="${url}" style="display:inline-block;padding:12px 24px;background-color:#3B82F6;color:#FFFFFF;font-size:15px;font-weight:600;text-decoration:none;border-radius:6px;">Reset Password</a>
      </div>

      <p style="margin:16px 0 4px;font-size:13px;line-height:20px;color:#9CA3AF;">Or paste this link into your browser:</p>
      <a href="${url}" style="font-size:13px;color:#60A5FA;word-break:break-all;">${url}</a>

      <hr style="margin:24px 0;border:none;border-top:1px solid #374151;" />

      <p style="margin:0 0 4px;font-size:12px;line-height:18px;color:#9CA3AF;">This link expires on ${expires} and can only be used once.</p>
      <p style="margin:0 0 4px;font-size:12px;line-height:18px;color:#9CA3AF;">
        If you didn't request this, you can safely ignore this email &mdash; your password won't change.
      </p>
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
    "We received a request to reset your Alliance Command Center password. Use the link below to choose a new one:",
    "",
    reset.resetUrl,
    "",
    `This link expires on ${formatExpiration(reset.expiresAt)} and can only be used once.`,
    "If you didn't request this, you can safely ignore this email - your password won't change.",
    `Questions? Contact us at ${SUPPORT_EMAIL}.`,
    "",
  ].join("\n");

  return { html, text };
}
