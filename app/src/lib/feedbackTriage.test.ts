import { describe, it, expect } from "vitest";
import {
  resolveTriageDiffForTest,
  validateGithubIssueUrl,
  type FeedbackTriageProjection,
} from "./feedbackTriage";

const baseProjection = (): FeedbackTriageProjection => ({
  feedbackId: "fb1",
  status: "NEW",
  needsResponse: true,
  githubIssueUrl: null,
  stateRevision: 0,
  lastEventAt: null,
  lastStateChangeAt: null,
  lastStateChangeActorEmail: null,
  lastStateChangeActorDisplayName: null,
});

describe("feedbackTriage invariants", () => {
  it("rejects no-op when nothing changes", () => {
    const result = resolveTriageDiffForTest(baseProjection(), {
      status: "NEW",
      needsResponse: true,
    });
    expect(result).toEqual({ ok: false, code: "NO_CHANGES" });
  });

  it("treats blank note as no note (no-op when note-only)", () => {
    const result = resolveTriageDiffForTest(baseProjection(), { note: "   " });
    expect(result).toEqual({ ok: false, code: "NO_CHANGES" });
  });

  it("drops redundant status without recording it", () => {
    const result = resolveTriageDiffForTest(baseProjection(), {
      status: "NEW",
      note: "internal note",
    });
    expect(result).toMatchObject({
      noteText: "internal note",
      isStateMutating: false,
    });
    if (!("ok" in result)) {
      expect(result.status).toBeUndefined();
    }
  });

  it("accepts valid GitHub issue URLs", () => {
    expect(
      validateGithubIssueUrl("https://github.com/org/repo/issues/42"),
    ).toBe(true);
  });

  it("rejects invalid GitHub URL patterns", () => {
    expect(validateGithubIssueUrl("https://github.com/org/repo/pull/1")).toBe(
      false,
    );
    expect(validateGithubIssueUrl("https://github.com/org/repo")).toBe(false);
    expect(validateGithubIssueUrl("not-a-url")).toBe(false);
  });

  it("sets githubIssueUrlChanged false when githubIssueUrl is untouched", () => {
    const result = resolveTriageDiffForTest(baseProjection(), {
      status: "TRIAGED",
    });
    expect(result).toMatchObject({
      status: "TRIAGED",
      githubIssueUrlChanged: false,
      isStateMutating: true,
    });
    if (!("ok" in result)) {
      expect(result.githubIssueUrlChangedTo).toBeUndefined();
    }
  });

  it("sets githubIssueUrlChanged true with value when setting URL", () => {
    const url = "https://github.com/org/repo/issues/99";
    const result = resolveTriageDiffForTest(baseProjection(), {
      githubIssueUrl: url,
    });
    expect(result).toMatchObject({
      githubIssueUrlChanged: true,
      githubIssueUrlChangedTo: url,
      isStateMutating: true,
    });
  });

  it("sets githubIssueUrlChanged true with null when explicitly clearing", () => {
    const current = {
      ...baseProjection(),
      githubIssueUrl: "https://github.com/org/repo/issues/1",
    };
    const result = resolveTriageDiffForTest(current, { githubIssueUrl: null });
    expect(result).toMatchObject({
      githubIssueUrlChanged: true,
      githubIssueUrlChangedTo: null,
      isStateMutating: true,
    });
  });

  it("rejects invalid GitHub URL at validation boundary", () => {
    const result = resolveTriageDiffForTest(baseProjection(), {
      githubIssueUrl: "https://github.com/org/repo/pull/1",
    });
    expect(result).toEqual({
      ok: false,
      code: "VALIDATION",
      message:
        "GitHub URL must match https://github.com/{owner}/{repo}/issues/{number}",
    });
  });

  it("treats setting the same githubIssueUrl as no-op", () => {
    const url = "https://github.com/org/repo/issues/5";
    const current = { ...baseProjection(), githubIssueUrl: url };
    const result = resolveTriageDiffForTest(current, { githubIssueUrl: url });
    expect(result).toEqual({ ok: false, code: "NO_CHANGES" });
  });
});
