import type { DeliverEmailRequest, EmailResult, EmailTransport } from "../types";

/**
 * Preview safety wrapper (ADR-016).
 *
 * Wraps a real transport and refuses to deliver unless EVERY envelope recipient
 * is on the allowlist. Used only on Vercel Preview: even when a Resend key is
 * configured, a preview build may email approved testers only — never a real
 * user — so an unmerged/experimental build can't send live security links to
 * production accounts.
 *
 * `DeliverEmailRequest` currently exposes a single `to` (which may itself hold
 * several comma-separated addresses) and no cc/bcc. We parse ALL addresses so
 * the gate stays correct if the envelope grows, and skip the send (never
 * partially deliver) if any recipient is off-list.
 */
export class AllowlistTransport implements EmailTransport {
  private readonly allow: Set<string>;

  constructor(
    private readonly inner: EmailTransport,
    allow: string[]
  ) {
    this.allow = new Set(allow.map((a) => a.trim().toLowerCase()).filter(Boolean));
  }

  async deliver(request: DeliverEmailRequest): Promise<EmailResult> {
    const recipients = extractRecipients(request);
    const blocked = recipients.filter((r) => !this.allow.has(r.toLowerCase()));

    if (recipients.length === 0 || blocked.length > 0) {
      // Log metadata only — never the body/token — mirroring LoggingTransport.
      console.warn(
        "[email] preview allowlist: skipped send to non-allowlisted recipient(s)",
        {
          subject: request.subject,
          recipientCount: recipients.length,
          blockedCount: blocked.length,
          metadata: request.metadata,
        }
      );
      return { status: "skipped" };
    }

    return this.inner.deliver(request);
  }
}

/** Every address across the message envelope (today: the `to` field only). */
function extractRecipients(request: DeliverEmailRequest): string[] {
  return request.to
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
