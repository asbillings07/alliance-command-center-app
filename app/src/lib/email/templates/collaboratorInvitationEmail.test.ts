import { describe, expect, it } from "vitest";
import { renderCollaboratorInvitationEmail } from "./collaboratorInvitationEmail";

describe("collaborator invitation email", () => {
  const invitation = { id: "invite-1", allianceName: "Alliance One", playerName: "Player", role: "LEADER" as const, inviteUrl: "https://example.com/invite/token", inviteCode: "ABC-DEF-GHJ", expiresAt: new Date("2026-12-01T16:30:00Z") };
  it("uses the alliance acceptance route, role and expiration in HTML and plain text", () => {
    const email = renderCollaboratorInvitationEmail(invitation);
    for (const body of [email.html, email.text]) {
      expect(body).toContain(invitation.inviteUrl);
      expect(body).toContain("Leader");
      expect(body).toContain("Alliance One");
      expect(body).toContain(invitation.inviteCode);
      expect(body).toContain("UTC");
      expect(body).not.toContain("/redeem/");
      expect(body).not.toContain("set up your alliance workspace");
    }
  });
  it("escapes untrusted player names, links and codes in HTML", () => {
    const email = renderCollaboratorInvitationEmail({ ...invitation, playerName: '<img src=x onerror="alert(1)">', inviteCode: "<code>", inviteUrl: 'https://example.com/invite/a?b=1&c="x"' });
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
    expect(email.html).toContain("&amp;c=&quot;x&quot;");
    expect(email.html).toContain("&lt;code&gt;");
  });
});
