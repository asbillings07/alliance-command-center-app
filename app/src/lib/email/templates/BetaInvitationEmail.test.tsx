import { describe, it, expect } from "vitest";
import { render } from "@react-email/render";
import { BetaInvitationEmail } from "./BetaInvitationEmail";
import type { BetaInvitationView } from "../types";

const invitation: BetaInvitationView = {
  id: "inv_1",
  email: "invitee@example.com",
  inviteUrl: "https://app.example.com/redeem/tok_abc",
  inviteCode: "ABC-123",
  expiresAt: new Date("2026-08-01T00:00:00Z"),
};

describe("BetaInvitationEmail", () => {
  it("renders the invite url, code, and expiration in HTML", async () => {
    const html = await render(<BetaInvitationEmail invitation={invitation} />);

    expect(html).toContain("https://app.example.com/redeem/tok_abc");
    expect(html).toContain("ABC-123");
    expect(html).toContain("2026");
  });

  it("renders a plain text version with the invite url", async () => {
    const text = await render(<BetaInvitationEmail invitation={invitation} />, {
      plainText: true,
    });

    expect(text).toContain("https://app.example.com/redeem/tok_abc");
    expect(text).toContain("ABC-123");
  });
});
