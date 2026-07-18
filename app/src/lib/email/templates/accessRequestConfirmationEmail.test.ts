import { describe, it, expect } from "vitest";
import { renderAccessRequestConfirmationEmail } from "./accessRequestConfirmationEmail";

describe("renderAccessRequestConfirmationEmail", () => {
  it("greets the recipient by name when provided", () => {
    const { html, text } = renderAccessRequestConfirmationEmail({ name: "Jane" });

    expect(html).toContain("Hi Jane,");
    expect(text).toContain("Hi Jane,");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("falls back to a generic greeting when no name is provided", () => {
    const { html, text } = renderAccessRequestConfirmationEmail({});

    expect(html).toContain("Hi,");
    expect(text).toContain("Hi,");
  });

  it("makes clear this is a confirmation, not an invitation", () => {
    const { text } = renderAccessRequestConfirmationEmail({ name: "Jane" });

    expect(text).toMatch(/received your request/i);
    expect(text).toMatch(/invite-only/i);
    expect(text).not.toContain("<");
  });

  it("escapes HTML-significant characters in the name", () => {
    const { html } = renderAccessRequestConfirmationEmail({
      name: 'Jane <script> & "friends"',
    });

    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;");
  });
});
