import { describe, it, expect } from "vitest";
import { renderEmailChangeVerificationEmail } from "./emailChangeVerificationEmail";
import type { EmailChangeVerificationView } from "../types";

const verification: EmailChangeVerificationView = {
  verifyUrl: "https://app.example.com/account/email/verify/tok_abc",
  expiresAt: new Date("2026-08-01T13:30:00Z"),
};

describe("renderEmailChangeVerificationEmail", () => {
  it("includes the verify url and doctype in the HTML", () => {
    const { html } = renderEmailChangeVerificationEmail(verification);

    expect(html).toContain(
      "https://app.example.com/account/email/verify/tok_abc"
    );
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("formats the expiration in UTC", () => {
    const { html, text } = renderEmailChangeVerificationEmail(verification);

    expect(html).toContain("August 1, 2026");
    expect(html).toContain("(UTC)");
    expect(text).toContain("(UTC)");
  });

  it("includes the verify url in the plain-text fallback and no HTML", () => {
    const { text } = renderEmailChangeVerificationEmail(verification);

    expect(text).toContain(
      "https://app.example.com/account/email/verify/tok_abc"
    );
    expect(text).not.toContain("<");
  });

  it("escapes HTML-significant characters in the verify url", () => {
    const { html } = renderEmailChangeVerificationEmail({
      ...verification,
      verifyUrl: "https://app.example.com/verify/a\"b<c>",
    });

    expect(html).not.toContain('a"b<c>');
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;c&gt;");
  });
});
