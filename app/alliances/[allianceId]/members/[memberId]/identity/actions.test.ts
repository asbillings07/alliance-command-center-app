import { describe, it, expect, vi, beforeEach } from "vitest";
import { saveIdentityDecision } from "./actions";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { decideMemberIdentity, IdentityReviewError } from "@/app/src/lib/memberIdentity";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({ requireAllianceAccess: vi.fn() }));
vi.mock("@/app/src/lib/memberIdentity", () => ({ decideMemberIdentity: vi.fn(), IdentityReviewError: class extends Error {} }));
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
});
