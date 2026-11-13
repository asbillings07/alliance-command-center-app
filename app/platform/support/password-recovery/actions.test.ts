import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: vi.fn() }));
vi.mock("@/app/src/lib/platform/passwordRecovery", () => ({ issueAssistedPasswordReset: vi.fn() }));
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { issueAssistedPasswordReset } from "@/app/src/lib/platform/passwordRecovery";
import { createRecoveryLink } from "./actions";

function form() {
  const f = new FormData();
  f.set("targetUserId", "target"); f.set("expectedEmail", "target@example.test"); f.set("operatorPassword", "private-value"); f.set("identityConfirmed", "yes");
  return f;
}
beforeEach(() => { vi.resetAllMocks(); vi.mocked(requirePlatformAdmin).mockResolvedValue({ id: "operator", email: "operator@example.test" }); });
describe("createRecoveryLink", () => {
  it("rejects non-platform administrators before reaching the recovery service", async () => {
    vi.mocked(requirePlatformAdmin).mockRejectedValue(new Error("redirect"));
    await expect(createRecoveryLink(form())).rejects.toThrow("redirect");
    expect(issueAssistedPasswordReset).not.toHaveBeenCalled();
  });
  it("binds the operator to the authenticated account and forwards explicit identity confirmation", async () => {
    vi.mocked(issueAssistedPasswordReset).mockResolvedValue({ ok: false, error: "Password not verified" });
    const f = form(); f.set("actorId", "attacker");
    expect(await createRecoveryLink(f)).toEqual({ ok: false, error: "Password not verified" });
    expect(issueAssistedPasswordReset).toHaveBeenCalledWith("operator", { targetUserId: "target", expectedEmail: "target@example.test", operatorPassword: "private-value", identityConfirmed: true });
  });
  it("does not treat a missing confirmation as consent", async () => {
    vi.mocked(issueAssistedPasswordReset).mockResolvedValue({ ok: false, error: "Identity required" });
    const f = form(); f.delete("identityConfirmed"); await createRecoveryLink(f);
    expect(issueAssistedPasswordReset).toHaveBeenCalledWith("operator", expect.objectContaining({ identityConfirmed: false }));
  });
  it("does not expose or log raw errors, passwords or tokens on an uncertain response", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(issueAssistedPasswordReset).mockRejectedValue(new Error("private-value raw-token"));
    const result = await createRecoveryLink(form());
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining("Could not confirm") });
    expect(JSON.stringify(result)).not.toContain("private-value");
    expect(log).toHaveBeenCalledWith("[platform-recovery] Recovery link creation could not be confirmed");
    log.mockRestore();
  });
});
