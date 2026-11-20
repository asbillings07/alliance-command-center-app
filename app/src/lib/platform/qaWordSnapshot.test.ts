import { afterEach, describe, expect, it, vi } from "vitest";
const { admin, isolated } = vi.hoisted(() => ({ admin: vi.fn(), isolated: vi.fn() }));
vi.mock("../auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: admin }));
vi.mock("../ocr/deploymentIsolation", () => ({ originalOcrAllowanceDatabase: isolated }));
vi.mock("next/navigation", () => ({ notFound() { throw Error("unavailable"); } }));
import { getQaWordSnapshot } from "./qaWordSnapshot";

afterEach(() => { vi.unstubAllEnvs(); vi.resetAllMocks(); });
describe("WORD QA activity", () => {
  const row = { id: "00000001", firstId: "00000001", createdAt: "2026-11-19T12:00:00Z", status: "READY",
    outcome: null, retry: false, automaticRetry: false, scores: 2, lastSavedAt: "2026-11-19T23:59:00Z" };
  function configure(activity = [row]) {
    isolated.mockReturnValue(true);
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/platform-ocr-attempt-history");
    vi.stubEnv("OCR_QA_WORD_ACTIVITY", JSON.stringify({ capturedAt: "2026-11-20T00:01:00Z", scans: 2, retries: 0, failures: 0, saves: 1, confirmedScores: 2, activity }));
  }
  it("shows a later confirmation on an earlier scan and keeps older history under All time", async () => {
    configure([row, { ...row, id: "00000002", lastSavedAt: row.createdAt }]);
    expect((await getQaWordSnapshot(true)).activity.map(a => a.id)).toEqual([row.id]);
    expect((await getQaWordSnapshot(false)).activity).toHaveLength(2);
  });
  it("requires Platform admin and the exact isolated target", async () => {
    configure();
    admin.mockRejectedValueOnce(new Error("denied"));
    await expect(getQaWordSnapshot(false)).rejects.toThrow("denied");
    expect(isolated).not.toHaveBeenCalled();
    isolated.mockReturnValue(false);
    await expect(getQaWordSnapshot(false)).rejects.toThrow("unavailable");
  });
  it("rejects malformed snapshots and non-opaque image references", async () => {
    configure([{ ...row, id: "private filename" }]);
    await expect(getQaWordSnapshot(false)).rejects.toThrow("unavailable");
    vi.stubEnv("OCR_QA_WORD_ACTIVITY", "");
    await expect(getQaWordSnapshot(false)).rejects.toThrow("unavailable");
  });
});
