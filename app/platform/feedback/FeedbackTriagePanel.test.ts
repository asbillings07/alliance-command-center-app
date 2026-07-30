import { describe, it, expect } from "vitest";
import { applyConflictBaseline } from "./staleConflict";
import {
  formatHistoryEventChanges,
  getResponseIndicatorState,
} from "./labels";
import { buildFeedbackHref } from "./urlParams";

describe("feedback triage stale-conflict recovery", () => {
  it("applyConflictBaseline copies authoritative state for resubmission", () => {
    const baseline = applyConflictBaseline({
      status: "PLANNED",
      needsResponse: false,
      githubIssueUrl: "https://github.com/org/repo/issues/42",
      stateRevision: 4,
      lastStateChangeAt: new Date("2026-07-29T12:00:00Z"),
      lastStateChangeActorEmail: "op@example.test",
      lastStateChangeActorDisplayName: "Operator",
    });

    expect(baseline).toEqual({
      status: "PLANNED",
      needsResponse: false,
      githubIssueUrl: "https://github.com/org/repo/issues/42",
      stateRevision: 4,
    });
  });
});

describe("feedback response indicator copy", () => {
  it('shows "Unreviewed" for legacy items with no triage events', () => {
    expect(
      getResponseIndicatorState({
        hasBeenTriaged: false,
        needsResponse: true,
      }),
    ).toBe("unreviewed");
  });

  it('shows "Needs response" after triage when needsResponse is true', () => {
    expect(
      getResponseIndicatorState({
        hasBeenTriaged: true,
        needsResponse: true,
      }),
    ).toBe("needs_response");
  });

  it('shows "No response needed" after triage when needsResponse is false', () => {
    expect(
      getResponseIndicatorState({
        hasBeenTriaged: true,
        needsResponse: false,
      }),
    ).toBe("no_response_needed");
  });
});

describe("feedback summary card URLs", () => {
  it("status cards replace the status filter and toggle off when active", () => {
    expect(
      buildFeedbackHref({ status: "NEW", search: "bug" }, { toggleStatus: "NEW" }),
    ).toBe("/platform/feedback?search=bug");
    expect(
      buildFeedbackHref({ search: "bug" }, { toggleStatus: "TRIAGED" }),
    ).toBe("/platform/feedback?search=bug&status=TRIAGED");
  });

  it("needs-response card toggles needsResponse while preserving other facets", () => {
    expect(
      buildFeedbackHref(
        { category: "BUG", needsResponse: "true" },
        { toggleNeedsResponse: true },
      ),
    ).toBe("/platform/feedback?category=BUG");
    expect(
      buildFeedbackHref({ category: "BUG" }, { toggleNeedsResponse: true }),
    ).toBe("/platform/feedback?category=BUG&needsResponse=true");
  });

  it("total card clears status and needsResponse filters", () => {
    expect(
      buildFeedbackHref(
        { status: "NEW", needsResponse: "true", wave: "Wave 1" },
        { clearStatus: true },
      ),
    ).toBe("/platform/feedback?wave=Wave+1");
  });
});

describe("feedback history formatting", () => {
  it("renders legible diff fields for an event", () => {
    const changes = formatHistoryEventChanges({
      statusChangedTo: "TRIAGED",
      noteText: "Investigating",
      needsResponseChangedTo: true,
      githubIssueUrlChanged: true,
      githubIssueUrlChangedTo: "https://github.com/org/repo/issues/1",
    });

    expect(changes).toEqual([
      "Status changed to Triaged",
      "Note: Investigating",
      "Needs response: on",
      "GitHub link set to https://github.com/org/repo/issues/1",
    ]);
  });
});
