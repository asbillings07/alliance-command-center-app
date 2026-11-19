import { beforeEach, describe, expect, it, vi } from "vitest";
import { auth } from "@/app/src/lib/auth";
import { renameQaAlliance } from "@/app/src/lib/ocr/qaAlliance";
import { OcrEvaluationError } from "@/app/src/lib/ocr/config";
import { saveQaAllianceName } from "./qa-actions";
vi.mock("@/app/src/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/app/src/lib/ocr/qaAlliance", () => ({ renameQaAlliance: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
beforeEach(() => { vi.clearAllMocks(); vi.mocked(auth).mockResolvedValue({ user: { id: "session-owner" } } as never); });
describe("QA name action", () => {
  it("uses the authenticated actor and the explicit confirmed name/version", async () => {
    await saveQaAllianceName("test-alliance", "[QA] Test", 3, true);
    expect(renameQaAlliance).toHaveBeenCalledWith({ allianceId: "test-alliance", actorId: "session-owner", name: "[QA] Test", identityVersion: 3, acknowledged: true });
  });
  it("rejects anonymous, malformed and unconfirmed requests without a write", async () => {
    expect(await saveQaAllianceName("a", "new", 0, false)).toHaveProperty("error");
    expect(await saveQaAllianceName("a", null as never, 0, true)).toHaveProperty("error");
    vi.mocked(auth).mockResolvedValue(null as never);
    expect(await saveQaAllianceName("a", "new", 0, true)).toHaveProperty("error");
    expect(renameQaAlliance).not.toHaveBeenCalled();
  });
  it("reports domain refusals and uncertain errors without leaking details or claiming rollback", async () => {
    vi.mocked(renameQaAlliance).mockRejectedValueOnce(new OcrEvaluationError("Reload this changed alliance"));
    expect(await saveQaAllianceName("a", "new", 0, true)).toEqual({ error: "Reload this changed alliance" });
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      vi.mocked(renameQaAlliance).mockRejectedValue(new Error("private connection details"));
      const result = await saveQaAllianceName("a", "new", 0, true);
      expect(result.error).toContain("Reload to check"); expect(result.error).not.toContain("private connection");
    } finally { log.mockRestore(); }
  });
});
