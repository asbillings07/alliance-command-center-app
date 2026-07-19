import { describe, it, expect } from "vitest";
import { renderFeedbackNotificationEmail } from "./feedbackNotificationEmail";
import type { FeedbackNotificationView } from "../types";

const base: FeedbackNotificationView = {
  referenceId: "8a2f4c91",
  categoryLabel: "Something was confusing",
  message: "VS Score didn't match what I expected.",
  submitterEmail: "alice@example.com",
  url: "/alliances/a1/periods/p1/import",
  submittedAt: new Date("2026-07-19T04:05:06.000Z"),
};

describe("renderFeedbackNotificationEmail", () => {
  it("renders the reference id, category, submitter and message", () => {
    const { html, text } = renderFeedbackNotificationEmail(base);

    expect(html).toContain("AllianceHQ Feedback #8a2f4c91");
    expect(html).toContain("Something was confusing");
    expect(html).toContain("alice@example.com");
    expect(html).toContain("VS Score didn&#39;t match what I expected.");

    expect(text).toContain("AllianceHQ Feedback #8a2f4c91");
    expect(text).toContain("Category: Something was confusing");
    expect(text).toContain("Submitted at: 2026-07-19 04:05:06 UTC");
  });

  it("includes alliance/period/version/viewport rows when present", () => {
    const { text } = renderFeedbackNotificationEmail({
      ...base,
      allianceName: "Phoenix Rising",
      periodLabel: "Week 184",
      appVersion: "1.0.0-beta.4+abc123",
      viewport: "390x844",
    });

    expect(text).toContain("Alliance: Phoenix Rising");
    expect(text).toContain("Period: Week 184");
    expect(text).toContain("Version: 1.0.0-beta.4+abc123");
    expect(text).toContain("Viewport: 390x844");
  });

  it("omits optional rows when absent", () => {
    const { text } = renderFeedbackNotificationEmail(base);

    expect(text).not.toContain("Alliance:");
    expect(text).not.toContain("Period:");
    expect(text).not.toContain("Version:");
    expect(text).not.toContain("Viewport:");
  });

  it("escapes HTML in interpolated values", () => {
    const { html } = renderFeedbackNotificationEmail({
      ...base,
      message: "<script>alert(1)</script>",
    });

    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
