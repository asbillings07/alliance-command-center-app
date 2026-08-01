import { describe, it, expect } from "vitest";
import {
  formatActorLabel,
  formatHistoryEventDetails,
  formatHistoryEventSummary,
} from "./labels";
import { applyConflictBaseline } from "./staleConflict";
import type { AccessRequestTriageHistoryItem } from "@/app/src/lib/platform/accessRequestInbox";

function buildEvent(overrides: Partial<AccessRequestTriageHistoryItem> = {}): AccessRequestTriageHistoryItem {
  return {
    id: "evt_1",
    eventType: "NOTE_ADDED",
    previousStatus: null,
    nextStatus: null,
    actorEmail: "op@example.test",
    actorDisplayName: "Operator",
    createdAt: new Date("2026-07-29T12:00:00Z"),
    noteText: null,
    declineReason: null,
    resolutionReason: null,
    reopenReason: null,
    betaWave: null,
    blockedReason: null,
    blockedConflictType: null,
    conflictUserEmail: null,
    conflictUserDisplayName: null,
    conflictAllianceName: null,
    conflictMembershipCount: null,
    linkedInvitationId: null,
    ...overrides,
  };
}

describe("formatActorLabel", () => {
  it("prefers display name when present", () => {
    expect(formatActorLabel("op@example.test", "Operator")).toBe("Operator (op@example.test)");
  });

  it("falls back to email alone", () => {
    expect(formatActorLabel("op@example.test", null)).toBe("op@example.test");
  });
});

describe("formatHistoryEventSummary", () => {
  it("summarizes each event type distinctly, including non-transition events", () => {
    expect(formatHistoryEventSummary(buildEvent({ eventType: "NOTE_ADDED" }))).toBe("Note added");
    expect(formatHistoryEventSummary(buildEvent({ eventType: "CONVERSION_BLOCKED" }))).toBe(
      "Approval blocked",
    );
    expect(formatHistoryEventSummary(buildEvent({ eventType: "RESOLVED_EXISTING_ACCESS" }))).toBe(
      "Resolved — already has access",
    );
  });
});

describe("formatHistoryEventDetails", () => {
  it("includes the reason text and conflict evidence snapshot when present", () => {
    const details = formatHistoryEventDetails(
      buildEvent({
        eventType: "CONVERSION_BLOCKED",
        blockedReason: "This user already has access to an alliance",
        blockedConflictType: "EXISTING_ALLIANCE_ACCESS",
        conflictAllianceName: "Alpha Alliance",
        conflictMembershipCount: 2,
        conflictUserEmail: "tester@example.test",
        conflictUserDisplayName: "Tester",
      }),
    );

    expect(details).toEqual([
      "This user already has access to an alliance",
      "Alliance: Alpha Alliance (2 memberships)",
      "User: Tester (tester@example.test)",
      "Conflict: Already has alliance access",
    ]);
  });

  it("shows only the beta wave for an INVITED event", () => {
    expect(formatHistoryEventDetails(buildEvent({ eventType: "INVITED", betaWave: "Wave 3" }))).toEqual([
      "Beta wave: Wave 3",
    ]);
  });

  it("shows no detail lines for a bare note-less event", () => {
    expect(formatHistoryEventDetails(buildEvent())).toEqual([]);
  });
});

describe("applyConflictBaseline", () => {
  it("copies only the four baseline fields needed for resubmission", () => {
    const baseline = applyConflictBaseline({
      status: "RESOLVED_EXISTING_ACCESS",
      betaWave: null,
      currentReason: "Already a member",
      stateRevision: 4,
      conflictUserEmail: "tester@example.test",
      conflictUserDisplayName: "Tester",
      conflictAllianceName: "Alpha Alliance",
      conflictMembershipCount: 1,
      lastStateChangeAt: new Date("2026-07-29T12:00:00Z"),
      lastStateChangeActorEmail: "op@example.test",
      lastStateChangeActorDisplayName: "Operator",
    });

    expect(baseline).toEqual({
      status: "RESOLVED_EXISTING_ACCESS",
      betaWave: null,
      currentReason: "Already a member",
      stateRevision: 4,
    });
  });
});
