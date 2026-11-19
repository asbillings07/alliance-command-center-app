import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/app/src/lib/auth/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("@/app/src/lib/ocr/consent", () => ({ decideOcrConsent: vi.fn(), loadOcrConsent: vi.fn() }));
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { decideOcrConsent, loadOcrConsent } from "@/app/src/lib/ocr/consent";
import { refreshOcrConsent, updateOcrConsent } from "./actions";
import { OCR_PROCESSING_NOTICE } from "@/app/src/lib/ocr/consentPolicy";

describe("personal OCR preference actions", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAuth).mockResolvedValue({ id: "signed-in-person", email: "synthetic@example.test" } as Awaited<ReturnType<typeof requireAuth>>);
  });
  it("binds changes to the authenticated account, ignoring a forged subject", async () => {
    const input = { purpose: "PROCESSING" as const, granted: true, expectedId: null, noticeVersion: OCR_PROCESSING_NOTICE, userId: "someone-else" };
    vi.mocked(decideOcrConsent).mockResolvedValue({ processing: null, quality: null });
    await updateOcrConsent(input);
    expect(decideOcrConsent).toHaveBeenCalledWith("signed-in-person", input);
  });
  it("reads only this account and does not leak database errors", async () => {
    vi.mocked(loadOcrConsent).mockRejectedValue(new Error("private connection text"));
    const result = await refreshOcrConsent();
    expect(loadOcrConsent).toHaveBeenCalledWith("signed-in-person");
    expect(JSON.stringify(result)).not.toContain("private connection text");
    expect(result.error).toBeDefined();
  });
  it("does not call preference storage without authentication", async () => {
    vi.mocked(requireAuth).mockRejectedValue(new Error("sign in"));
    await expect(updateOcrConsent({ purpose: "PROCESSING", granted: true, expectedId: null, noticeVersion: OCR_PROCESSING_NOTICE })).rejects.toThrow("sign in");
    expect(decideOcrConsent).not.toHaveBeenCalled();
  });
});
