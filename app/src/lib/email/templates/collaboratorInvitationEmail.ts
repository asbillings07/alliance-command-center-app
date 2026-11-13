import type { CollaboratorInvitationEmailInput, EmailContent } from "../types";

const roles = { ADMIN: "Admin", LEADER: "Leader", VIEWER: "Viewer" };
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

export function renderCollaboratorInvitationEmail(invitation: CollaboratorInvitationEmailInput["invitation"]): EmailContent {
  const expires = `${invitation.expiresAt.toLocaleString("en-US", { dateStyle: "long", timeStyle: "short", timeZone: "UTC" })} UTC`;
  const message = `You've been invited to collaborate with ${invitation.allianceName} as a ${roles[invitation.role]} in Alliance Command Center, linked to the player ${invitation.playerName}. Review the alliance and role on the invitation page before accepting.`;
  const url = escapeHtml(invitation.inviteUrl);
  return {
    html: `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>Alliance invitation</title></head>
<body style="margin:0;padding:24px 12px;background:#0F172A;font-family:Arial,sans-serif;color:#E5E7EB;">
<div style="max-width:480px;margin:auto;padding:28px;background:#111827;border:1px solid #374151;border-radius:12px;">
<h1 style="font-size:22px;color:#F9FAFB;">Alliance Command Center</h1>
<p style="line-height:24px;">${escapeHtml(message)}</p>
<p style="margin:24px 0;"><a href="${url}" style="display:inline-block;padding:12px 24px;background:#2563EB;color:white;text-decoration:none;border-radius:6px;">Review invitation</a></p>
<p style="font-size:13px;line-height:20px;">Or copy this link:<br /><a href="${url}" style="color:#93C5FD;word-break:break-all;">${url}</a></p>
<p>Invitation code: <strong>${escapeHtml(invitation.inviteCode)}</strong></p>
<p style="font-size:13px;">Expires ${escapeHtml(expires)}. If you weren't expecting this invitation, you can ignore it. No access is granted until you accept.</p>
<p style="font-size:13px;">Questions? <a href="mailto:support@alliancehq.app" style="color:#93C5FD;">support@alliancehq.app</a></p>
</div></body></html>`,
    text: ["Alliance Command Center", "", message, "", "Review invitation:", invitation.inviteUrl, "", `Invitation code: ${invitation.inviteCode}`, `Expires ${expires}.`, "If you weren't expecting this invitation, you can ignore it. No access is granted until you accept.", "Questions? Contact support@alliancehq.app."].join("\n"),
  };
}
