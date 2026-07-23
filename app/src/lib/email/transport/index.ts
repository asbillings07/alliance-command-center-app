import type { EmailTransport } from "../types";
import { isEmailEnabled } from "../isEmailEnabled";
import { ResendTransport } from "./resendTransport";
import { LoggingTransport } from "./loggingTransport";
import { AllowlistTransport } from "./allowlistTransport";

/** Parse a comma/whitespace-separated address allowlist. */
function parseAllowlist(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(/[,\s]+/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Select the transport for this deployment: Resend when configured, otherwise
 * a logging no-op. Callers never branch on NODE_ENV or env vars themselves.
 *
 * Preview safety (ADR-016): a Vercel Preview build must never send unrestricted
 * mail, even if it inherited a real Resend key — otherwise an unmerged build
 * could email live security links (invitations, reset, email-change) to real
 * users. On Preview we therefore default to the logging no-op and only send
 * when `PREVIEW_EMAIL_ALLOWLIST` explicitly names approved testers, gated by
 * {@link AllowlistTransport}. Defense in depth on top of a separate Preview
 * Resend credential (an operator configuration).
 */
export function createEmailTransport(): EmailTransport {
  if (process.env.VERCEL_ENV === "preview") {
    if (!isEmailEnabled()) return new LoggingTransport();
    const allow = parseAllowlist(process.env.PREVIEW_EMAIL_ALLOWLIST);
    if (allow.length === 0) {
      // Distinguish this from "email not configured": Resend IS configured,
      // but Preview intentionally refuses to send without an explicit
      // allowlist. LoggingTransport's own log line would otherwise read as a
      // missing-credentials misconfiguration.
      console.warn(
        "[email] Preview: Resend is configured but PREVIEW_EMAIL_ALLOWLIST is empty — all mail will be logged, not sent. Set PREVIEW_EMAIL_ALLOWLIST to send to approved testers."
      );
      return new LoggingTransport();
    }
    return new AllowlistTransport(
      new ResendTransport(
        process.env.RESEND_API_KEY as string,
        process.env.EMAIL_FROM as string,
      ),
      allow,
    );
  }

  if (isEmailEnabled()) {
    return new ResendTransport(
      process.env.RESEND_API_KEY as string,
      process.env.EMAIL_FROM as string,
    );
  }
  return new LoggingTransport();
}

/**
 * Module-level singleton so the Resend client is constructed once per process
 * rather than per send.
 */
export const transport: EmailTransport = createEmailTransport();
