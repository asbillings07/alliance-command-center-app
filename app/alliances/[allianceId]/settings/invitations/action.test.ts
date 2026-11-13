import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({ requireAllianceAccess: vi.fn() }));
vi.mock("@/app/src/lib/prisma", () => ({ prisma: { invitation: { findFirst: vi.fn() }, alliance: { findUniqueOrThrow: vi.fn() } } }));
vi.mock("@/app/src/lib/inviteLeadershipCollaborator", () => ({ inviteLeadershipCollaborator: vi.fn(), searchMembers: vi.fn(), cancelInvitation: vi.fn(), resendInvitation: vi.fn() }));
vi.mock("@/app/src/lib/email", () => ({ emailService: { sendCollaboratorInvitation: vi.fn() } }));
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { prisma } from "@/app/src/lib/prisma";
import { inviteLeadershipCollaborator, resendInvitation } from "@/app/src/lib/inviteLeadershipCollaborator";
import { emailService } from "@/app/src/lib/email";
import { inviteCollaborator, resendInvitationAction } from "./action";

const input = { allianceId: "alliance-1", playerName: "Player", email: "PLAYER@example.com", membershipRole: "LEADER" as const };
const invitation = { id: "invite-1", allianceId: "alliance-1", email: "player@example.com", playerNameSnapshot: "Stored Player", membershipRole: "LEADER" as const, code: "ABC-DEF-GHJ", expiresAt: new Date("2026-12-01"), createdAt: new Date("2026-11-01"), token: "test-token", acceptedAt: null, acceptedByUserId: null, cancelledAt: null, invitedById: "actor-1", allianceMemberId: "member-1" };
const persisted = { invitation, memberCreated: false, inviteUrl: "https://example.com/invite/current-token", inviteCode: invitation.code };
beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireAllianceAccess).mockResolvedValue({ user: { id: "actor-1" }, permissions: { canInviteCollaborators: true } } as Awaited<ReturnType<typeof requireAllianceAccess>>);
  vi.mocked(inviteLeadershipCollaborator).mockResolvedValue(persisted as Awaited<ReturnType<typeof inviteLeadershipCollaborator>>);
  vi.mocked(resendInvitation).mockResolvedValue(persisted as Awaited<ReturnType<typeof resendInvitation>>);
  vi.mocked(prisma.invitation.findFirst).mockResolvedValue(invitation);
  vi.mocked(prisma.alliance.findUniqueOrThrow).mockResolvedValue({ name: "Alliance One" } as Awaited<ReturnType<typeof prisma.alliance.findUniqueOrThrow>>);
  vi.mocked(emailService.sendCollaboratorInvitation).mockResolvedValue({ status: "sent", messageId: "provider-1" });
});

describe("collaborator invitation delivery", () => {
  it("sends only after persistence using the persisted recipient and invitation", async () => {
    const result = await inviteCollaborator(input);
    expect(vi.mocked(inviteLeadershipCollaborator).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(emailService.sendCollaboratorInvitation).mock.invocationCallOrder[0]);
    expect(emailService.sendCollaboratorInvitation).toHaveBeenCalledWith({ to: "player@example.com", invitation: { id: "invite-1", allianceName: "Alliance One", playerName: "Stored Player", role: "LEADER", inviteUrl: persisted.inviteUrl, inviteCode: invitation.code, expiresAt: invitation.expiresAt } });
    expect(result.data).toMatchObject({ emailStatus: "sent", inviteUrl: persisted.inviteUrl });
  });
  it.each(["failed", "skipped"] as const)("keeps the valid invitation and reports %s", async (status) => {
    vi.mocked(emailService.sendCollaboratorInvitation).mockResolvedValue({ status });
    expect(await inviteCollaborator(input)).toEqual({ data: { invitationId: invitation.id, inviteUrl: persisted.inviteUrl, inviteCode: invitation.code, memberCreated: false, emailStatus: status } });
  });
  it("keeps creation successful when an unexpected delivery exception leaves the outcome unknown", async () => {
    vi.mocked(emailService.sendCollaboratorInvitation).mockRejectedValue(new Error("private provider details"));
    const result = await inviteCollaborator(input);
    expect(result.data?.emailStatus).toBe("unknown");
    expect(result.error).toBeUndefined();
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private provider details");
  });
  it("does not send when persistence rejects the invitation", async () => {
    vi.mocked(inviteLeadershipCollaborator).mockRejectedValue(new Error("A pending invitation already exists"));
    expect((await inviteCollaborator(input)).error).toContain("pending");
    expect(emailService.sendCollaboratorInvitation).not.toHaveBeenCalled();
  });
  it("denies unauthorized creation and resend before any write or email", async () => {
    vi.mocked(requireAllianceAccess).mockResolvedValue({ permissions: { canInviteCollaborators: false } } as Awaited<ReturnType<typeof requireAllianceAccess>>);
    expect((await inviteCollaborator(input)).error).toContain("permission");
    expect((await resendInvitationAction("alliance-1", "invite-1")).error).toContain("permission");
    expect(inviteLeadershipCollaborator).not.toHaveBeenCalled();
    expect(resendInvitation).not.toHaveBeenCalled();
    expect(emailService.sendCollaboratorInvitation).not.toHaveBeenCalled();
  });
  it.each(["first@example.com,second@example.com", "name <player@example.com>", "not-an-email", "one,two@example.com"])("refuses a non-single recipient %s before writing", async (email) => {
    expect((await inviteCollaborator({ ...input, email })).error).toBeTruthy();
    expect(inviteLeadershipCollaborator).not.toHaveBeenCalled();
    expect(emailService.sendCollaboratorInvitation).not.toHaveBeenCalled();
  });
  it("rejects forged owner role", async () => {
    expect((await inviteCollaborator({ ...input, membershipRole: "OWNER" as "LEADER" })).error).toBeTruthy();
    expect(inviteLeadershipCollaborator).not.toHaveBeenCalled();
  });
  it("scopes resend to the authorized alliance and sends the newly persisted link", async () => {
    const result = await resendInvitationAction("alliance-1", "invite-1");
    expect(prisma.invitation.findFirst).toHaveBeenCalledWith({ where: { id: "invite-1", allianceId: "alliance-1" }, select: { id: true, email: true, membershipRole: true } });
    expect(result.data?.emailStatus).toBe("sent");
    expect(vi.mocked(resendInvitation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(emailService.sendCollaboratorInvitation).mock.invocationCallOrder[0]);
  });
  it("does not resend a cross-alliance invitation", async () => {
    vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);
    expect((await resendInvitationAction("other-alliance", "invite-1")).error).toBe("Invitation not found");
    expect(resendInvitation).not.toHaveBeenCalled();
    expect(emailService.sendCollaboratorInvitation).not.toHaveBeenCalled();
  });
  it.each([{ email: "one@example.com,two@example.com" }, { membershipRole: "OWNER" as const }])("does not rotate or send an invalid legacy invitation", async (invalid) => {
    vi.mocked(prisma.invitation.findFirst).mockResolvedValue({ ...invitation, ...invalid });
    expect((await resendInvitationAction("alliance-1", "invite-1")).error).toContain("Cancel it and create a new");
    expect(resendInvitation).not.toHaveBeenCalled();
    expect(emailService.sendCollaboratorInvitation).not.toHaveBeenCalled();
  });
});
