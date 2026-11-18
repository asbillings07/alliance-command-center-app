import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveMemberAccess } from "./actions";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { decideMemberSelfAccess, MemberAccessError } from "@/app/src/lib/memberSelfAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({ requireAllianceAccess: vi.fn() }));
vi.mock("@/app/src/lib/memberSelfAccess", () => ({ decideMemberSelfAccess: vi.fn(), MemberAccessError: class extends Error {} }));
vi.mock("@/app/src/lib/memberIdentity", () => ({ IdentityReviewError: class extends Error {} }));
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requireAllianceAccess).mockResolvedValue({ user: { id: "session-actor" } } as never); });
describe("member access action boundary", () => {
  it("derives actor and enforces focused member-access permission, forwarding no injected fields", async () => {
    expect((await saveMemberAccess("a", "m", { reviewKey: "r", grant: true, acknowledged: true, actorId: "victim", accountUserId: "other", allianceId: "other" } as never)).ok).toBe(true);
    expect(requireAllianceAccess).toHaveBeenCalledWith({ allianceId: "a", requiredPermission: Permissions.MANAGE_MEMBER_ACCESS });
    expect(decideMemberSelfAccess).toHaveBeenCalledWith({ allianceId: "a", memberId: "m", actorId: "session-actor", reviewKey: "r", grant: true, acknowledged: true });
  });
  it("rejects malformed requests and absent acknowledgement without writes", async () => {
    for (const input of [null, {}, { reviewKey: "r", grant: "yes", acknowledged: true }, { reviewKey: "r", grant: true, acknowledged: false }]) {
      expect((await saveMemberAccess("a", "m", input as never)).ok).toBe(false);
    }
    expect(decideMemberSelfAccess).not.toHaveBeenCalled();
  });
  it("does not write after authorization denial", async () => {
    vi.mocked(requireAllianceAccess).mockRejectedValue(new Error("denied"));
    await expect(saveMemberAccess("a", "m", { reviewKey: "r", grant: true, acknowledged: true })).rejects.toThrow("denied");
    expect(decideMemberSelfAccess).not.toHaveBeenCalled();
  });
  it("preserves domain refusal and reports uncertain outcomes without claiming rollback", async () => {
    const input = { reviewKey: "r", grant: false, acknowledged: true };
    vi.mocked(decideMemberSelfAccess).mockRejectedValue(new MemberAccessError("Review changed details"));
    expect(await saveMemberAccess("a", "m", input)).toEqual({ ok: false, message: "Review changed details" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(decideMemberSelfAccess).mockRejectedValue(new Error("connection interrupted"));
      expect(await saveMemberAccess("a", "m", input)).toMatchObject({ ok: false, message: expect.stringContaining("Reload and check access history") });
    } finally { log.mockRestore(); }
  });
});
