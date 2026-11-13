import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveIdentityDecision, saveIdentityName } from "./actions";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { decideMemberIdentity, correctMemberIdentityName, IdentityReviewError } from "@/app/src/lib/memberIdentity";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { revalidatePath } from "next/cache";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({ requireAllianceAccess: vi.fn() }));
vi.mock("@/app/src/lib/memberIdentity", () => ({ decideMemberIdentity: vi.fn(), correctMemberIdentityName: vi.fn(), IdentityReviewError: class extends Error {} }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(requireAllianceAccess).mockResolvedValue({ user: { id: "session-actor" } } as never); });
describe("identity action boundaries", () => {
  it("never accepts forged scope/actor fields in the submitted object", async () => {
    vi.mocked(decideMemberIdentity).mockResolvedValue({} as never);
    const input = { reviewKey: "review", confirm: true, acknowledged: true, actorId: "victim", allianceId: "other", memberId: "other" };
    await saveIdentityDecision("alliance", "member", input);
    expect(decideMemberIdentity).toHaveBeenCalledWith({ allianceId: "alliance", memberId: "member", actorId: "session-actor", reviewKey: "review", confirm: true, acknowledged: true });
  });
  it("rejects missing acknowledgement before a domain write", async () => {
    expect(await saveIdentityDecision("a", "m", { reviewKey: "r", confirm: true, acknowledged: false })).toMatchObject({ ok: false });
    expect(decideMemberIdentity).not.toHaveBeenCalled();
  });
  it("preserves a specific domain refusal", async () => {
    vi.mocked(decideMemberIdentity).mockRejectedValue(new IdentityReviewError("Reload this changed identity"));
    expect(await saveIdentityDecision("a", "m", { reviewKey: "r", confirm: false, acknowledged: true })).toEqual({ ok: false, message: "Reload this changed identity" });
  });
  it("uses focused permission and never forwards account, role, property or actor edits", async () => {
    vi.mocked(correctMemberIdentityName).mockResolvedValue({} as never);
    const result = await saveIdentityName("a", "m", { reviewKey: "r", playerName: "New name", acknowledged: true,
      actorId: "other", accountUserId: "victim", membershipRole: "OWNER", thp: 9 } as never);
    expect(result.ok).toBe(true);
    expect(requireAllianceAccess).toHaveBeenCalledWith({ allianceId: "a", requiredPermission: Permissions.MANAGE_MEMBER_IDENTITY });
    expect(correctMemberIdentityName).toHaveBeenCalledWith({ allianceId: "a", memberId: "m", actorId: "session-actor", reviewKey: "r", playerName: "New name", acknowledged: true });
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/a/members/m/identity");
    expect(revalidatePath).toHaveBeenCalledWith("/alliances/[allianceId]/reports/metrics/[metricId]", "page");
  });
  it("does not edit names without acknowledgement or with malformed input", async () => {
    for (const input of [null, { reviewKey: "r", playerName: 123, acknowledged: true }, { reviewKey: "r", playerName: "New", acknowledged: false }]) {
      expect(await saveIdentityName("a", "m", input as never)).toMatchObject({ ok: false });
    }
    expect(correctMemberIdentityName).not.toHaveBeenCalled();
  });
  it("reports uncertain name-update outcomes without claiming a rollback", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(correctMemberIdentityName).mockRejectedValue(new Error("database connection lost"));
    try {
      expect(await saveIdentityName("a", "m", { reviewKey: "r", playerName: "New", acknowledged: true })).toMatchObject({ ok: false, message: expect.stringContaining("Reload and check") });
    } finally { log.mockRestore(); }
  });
});
