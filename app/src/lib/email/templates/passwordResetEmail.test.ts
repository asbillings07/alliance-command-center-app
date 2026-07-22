import { describe, it, expect } from "vitest";
import { renderPasswordResetEmail } from "./passwordResetEmail";
import type { PasswordResetView } from "../types";

const reset: PasswordResetView = {
  resetUrl: "https://app.example.com/reset-password/tok_abc",
  expiresAt: new Date("2026-08-01T13:30:00Z"),
};

describe("renderPasswordResetEmail", () => {
  it("includes the reset url in the HTML", () => {
    const { html } = renderPasswordResetEmail(reset);

    expect(html).toContain("https://app.example.com/reset-password/tok_abc");
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Reset Password");
  });

  it("formats the expiration in UTC", () => {
    const { html, text } = renderPasswordResetEmail(reset);

    expect(html).toContain("(UTC)");
    expect(text).toContain("August 1, 2026");
    expect(text).toContain("(UTC)");
  });

  it("includes the reset url in the plain text fallback and no markup", () => {
    const { text } = renderPasswordResetEmail(reset);

    expect(text).toContain("https://app.example.com/reset-password/tok_abc");
    expect(text).not.toContain("<");
  });

  it("mentions that ignoring the email is safe", () => {
    const { html, text } = renderPasswordResetEmail(reset);

    expect(html.toLowerCase()).toContain("ignore this email");
    expect(text.toLowerCase()).toContain("ignore this email");
  });

  it("escapes HTML-significant characters in the reset url", () => {
    const { html } = renderPasswordResetEmail({
      ...reset,
      resetUrl: 'https://app.example.com/reset-password/a"b<c>',
    });

    expect(html).not.toContain('a"b<c>');
    expect(html).toContain("&quot;");
    expect(html).toContain("&lt;c&gt;");
  });
});
