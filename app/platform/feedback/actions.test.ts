import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequirePlatformAdmin = vi.fn();
const mockRecordFeedbackTriageEvent = vi.fn();
const mockListFeedbackTriageHistory = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: () => mockRequirePlatformAdmin(),
}));

vi.mock("@/app/src/lib/feedbackTriage", () => ({
  recordFeedbackTriageEvent: (...args: unknown[]) =>
    mockRecordFeedbackTriageEvent(...args),
}));

vi.mock("@/app/src/lib/platform/feedbackInbox", () => ({
  listFeedbackTriageHistory: (...args: unknown[]) =>
    mockListFeedbackTriageHistory(...args),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

import {
  fetchFeedbackTriageHistoryAction,
  recordFeedbackTriageEventAction,
} from "./actions";

describe("platform feedback actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePlatformAdmin.mockResolvedValue({ id: "operator-1" });
  });

  it("maps a successful triage event to success and revalidates", async () => {
    mockRecordFeedbackTriageEvent.mockResolvedValue({
      ok: true,
      projection: {
        stateRevision: 2,
        status: "TRIAGED",
        needsResponse: true,
        githubIssueUrl: null,
      },
    });

    const result = await recordFeedbackTriageEventAction("fb-1", 1, {
      status: "TRIAGED",
    });

    expect(result).toEqual({
      success: true,
      stateRevision: 2,
      status: "TRIAGED",
      needsResponse: true,
      githubIssueUrl: null,
    });
    expect(mockRecordFeedbackTriageEvent).toHaveBeenCalledWith(
      "fb-1",
      "operator-1",
      { status: "TRIAGED" },
      1,
    );
    expect(mockRevalidatePath).toHaveBeenCalledWith("/platform/feedback");
  });

  it("maps NO_CHANGES to a structured rejection", async () => {
    mockRecordFeedbackTriageEvent.mockResolvedValue({
      ok: false,
      code: "NO_CHANGES",
    });

    const result = await recordFeedbackTriageEventAction("fb-1", 1, {
      status: "NEW",
    });

    expect(result).toEqual({
      success: false,
      error: "No changes to save",
    });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("maps STALE_CONFLICT with conflict payload for recovery UI", async () => {
    const conflict = {
      status: "PLANNED" as const,
      needsResponse: false,
      githubIssueUrl: null,
      stateRevision: 3,
      lastStateChangeAt: new Date("2026-07-29T12:00:00Z"),
      lastStateChangeActorEmail: "other@example.test",
      lastStateChangeActorDisplayName: "Other Operator",
    };
    mockRecordFeedbackTriageEvent.mockResolvedValue({
      ok: false,
      code: "STALE_CONFLICT",
      conflict,
    });

    const result = await recordFeedbackTriageEventAction("fb-1", 1, {
      status: "TRIAGED",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("Someone else updated");
      expect(result.conflict).toEqual(conflict);
    }
  });

  it("maps VALIDATION rejection to structured error", async () => {
    mockRecordFeedbackTriageEvent.mockResolvedValue({
      ok: false,
      code: "VALIDATION",
      message:
        "GitHub URL must match https://github.com/{owner}/{repo}/issues/{number}",
    });

    const result = await recordFeedbackTriageEventAction("fb-1", 0, {
      githubIssueUrl: "https://example.com/not-github",
    });

    expect(result).toEqual({
      success: false,
      error:
        "GitHub URL must match https://github.com/{owner}/{repo}/issues/{number}",
    });
  });

  it("requires platform admin before recording triage events", async () => {
    mockRequirePlatformAdmin.mockRejectedValue(new Error("redirect:/app"));

    await expect(
      recordFeedbackTriageEventAction("fb-1", 0, { note: "hello" }),
    ).rejects.toThrow("redirect:/app");
    expect(mockRecordFeedbackTriageEvent).not.toHaveBeenCalled();
  });

  it("returns paginated history on success", async () => {
    mockListFeedbackTriageHistory.mockResolvedValue({
      items: [{ id: "evt-1" }],
      total: 1,
      page: 1,
      pageSize: 10,
    });

    const result = await fetchFeedbackTriageHistoryAction("fb-1", 1, 10);

    expect(result).toEqual({
      success: true,
      items: [{ id: "evt-1" }],
      total: 1,
      page: 1,
      pageSize: 10,
    });
  });

  it("requires platform admin before loading history", async () => {
    mockRequirePlatformAdmin.mockRejectedValue(new Error("redirect:/app"));

    await expect(fetchFeedbackTriageHistoryAction("fb-1")).rejects.toThrow(
      "redirect:/app",
    );
    expect(mockListFeedbackTriageHistory).not.toHaveBeenCalled();
  });
});
