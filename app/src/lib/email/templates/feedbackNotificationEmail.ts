import type { EmailContent, FeedbackNotificationView } from "../types";

/** Escape a value for safe interpolation into HTML. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Format a timestamp as an unambiguous UTC string. */
function formatUtc(date: Date): string {
  return `${date.toISOString().replace("T", " ").replace(/\.\d+Z$/, "")} UTC`;
}

/**
 * Render the operator feedback notification to HTML + plain text.
 *
 * Laid out like a scannable bug report: labeled rows (Category, Submitted by,
 * Alliance, Period, URL, Version, Viewport, Submitted at) followed by the
 * message body. Optional rows are omitted when the value is absent. Hand-rolled,
 * inline-styled markup; all interpolated values are HTML-escaped.
 */
export function renderFeedbackNotificationEmail(
  feedback: FeedbackNotificationView
): EmailContent {
  // Ordered rows; entries with an empty value are dropped so the email only
  // shows context that is actually known.
  const rows: Array<[label: string, value: string | undefined]> = [
    ["Category", feedback.categoryLabel],
    ["Submitted by", feedback.submitterEmail],
    ["Alliance", feedback.allianceName],
    ["Period", feedback.periodLabel],
    ["URL", feedback.url],
    ["Version", feedback.appVersion],
    ["Viewport", feedback.viewport],
    ["Submitted at", formatUtc(feedback.submittedAt)],
  ];
  const presentRows = rows.filter(
    (row): row is [string, string] => Boolean(row[1] && row[1].trim())
  );

  const heading = `AllianceHQ Feedback #${escapeHtml(feedback.referenceId)}`;

  const htmlRows = presentRows
    .map(
      ([label, value]) => `
      <tr>
        <td style="padding:4px 12px 4px 0;font-size:12px;color:#9CA3AF;vertical-align:top;white-space:nowrap;">${escapeHtml(
          label
        )}</td>
        <td style="padding:4px 0;font-size:14px;color:#E5E7EB;word-break:break-all;">${escapeHtml(
          value
        )}</td>
      </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${heading}</title>
  </head>
  <body style="margin:0;padding:24px 0;background-color:#0F172A;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <div style="max-width:560px;margin:0 auto;padding:32px;background-color:#111827;border:1px solid #374151;border-radius:12px;">
      <h1 style="margin:0 0 20px;font-size:18px;font-weight:700;color:#F9FAFB;">${heading}</h1>
      <table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;">${htmlRows}
      </table>
      <hr style="margin:20px 0;border:none;border-top:1px solid #374151;" />
      <p style="margin:0 0 8px;font-size:12px;color:#9CA3AF;">Message</p>
      <div style="font-size:14px;line-height:22px;color:#F3F4F6;white-space:pre-wrap;">${escapeHtml(
        feedback.message
      )}</div>
    </div>
  </body>
</html>`;

  const text = [
    heading,
    "",
    ...presentRows.map(([label, value]) => `${label}: ${value}`),
    "",
    "----------------------------------------",
    "",
    "Message",
    "",
    feedback.message,
    "",
  ].join("\n");

  return { html, text };
}
