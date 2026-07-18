import { describe, it, expect } from "vitest";
import { renderBetaInvitationEmail } from "./betaInvitationEmail";
import type { BetaInvitationView } from "../types";

const invitation: BetaInvitationView = {
  id: "inv_1",
  email: "invitee@example.com",
  inviteUrl: "https://app.example.com/redeem/tok_abc",
  inviteCode: "ABC-123",
  expiresAt: new Date("2026-08-01T00:00:00Z"),
};

describe("renderBetaInvitationEmail", () => {
  it("includes the invite url, code, and expiration in the HTML", () => {
    const { html } = renderBetaInvitationEmail(invitation);

    expect(html).toContain("https://app.example.com/redeem/tok_abc");
    expect(html).toContain("ABC-123");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("formats the expiration date in UTC to avoid off-by-one dates", () => {
    // 2026-08-01T00:00:00Z is July 31 in time zones behind UTC; pinning to UTC
    // must render August 1 regardless of the server's time zone.
    const { html, text } = renderBetaInvitationEmail(invitation);

    expect(html).toContain("August 1, 2026 (UTC)");
    expect(text).toContain("August 1, 2026 (UTC)");
  });

  it("includes the invite url and code in the plain text fallback", () => {
    const { text } = renderBetaInvitationEmail(invitation);

    expect(text).toContain("https://app.example.com/redeem/tok_abc");
    expect(text).toContain("ABC-123");
    expect(text).not.toContain("<");
  });

  it("escapes HTML-significant characters in interpolated values", () => {
    const { html } = renderBetaInvitationEmail({
      ...invitation,
      inviteUrl: "https://app.example.com/redeem/a\"b<c>",
      inviteCode: "X&Y",
    });

    expect(html).not.toContain('a"b<c>');
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;c&gt;");
    expect(html).toContain("X&amp;Y");
  });
});
