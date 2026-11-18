import { describe, expect, it } from "vitest";
import { resolveScoreReview, reviewLeaderScore, type ScoreContext, type ScoreReviewEvent, type MemberEvidence, type LeaderProposal, type LeaderDecision, type ScoreFinality } from "./scoreReview";
const context: ScoreContext = { allianceId: "alliance", memberId: "member", metricId: "metric", unit: "points", windowId: "confirmed-window" };
const actor = { userId: "account", name: "Jordan", role: "MEMBER" as const };
const evidence = (revision: number, value: number, finality: ScoreFinality = { kind: "in-progress" }): MemberEvidence => ({
  kind: "member-evidence", id: `member-${revision}`, revision, context, actor,
  result: { value, finality, sourceId: `image-row-${revision}`, capturedAt: null },
});
const proposal = (value: number, resolutions: LeaderProposal["resolutions"] = [], finality: ScoreFinality = { kind: "in-progress" }): LeaderProposal => ({
  context, resolutions, result: { value, finality, sourceId: "leader-source", capturedAt: null },
});
function decision(events: ScoreReviewEvent[], p: LeaderProposal): LeaderDecision {
  return { kind: "leader-decision", id: `leader-${events.length + 1}`, revision: events.length + 1, context,
    actor: { userId: "leader", name: "Taylor", role: "LEADER" }, proposal: p,
    review: { ...reviewLeaderScore(context, events, p), confirmed: true, lowerConfirmed: true } };
}
const rejected = (id: string) => ({ evidenceId: id, outcome: "rejected" as const, reason: "Wrong score read from source row" });

describe("qualified score review contract", () => {
  it("retains cumulative snapshots without summing or choosing the newest/highest as authoritative", () => {
    const events = [evidence(1, 10), evidence(2, 30), evidence(3, 20)];
    const before = structuredClone(events);
    expect(resolveScoreReview(context, events)).toMatchObject({ accepted: null, pending: events, revision: 3 });
    expect(events).toEqual(before);
  });
  it("keeps a leader decision authoritative when later member evidence arrives", () => {
    const events: ScoreReviewEvent[] = [evidence(1, 23)];
    const accepted = decision(events, proposal(20)); events.push(accepted, evidence(3, 31));
    const state = resolveScoreReview(context, events);
    expect(state.accepted?.proposal.result.value).toBe(20);
    expect(state.pending.map(e => e.result.value)).toEqual([23, 31]);
  });
  it.each([0, 1, 19, 20])("requires confirmation for every unresolved higher result at proposed %s", value => {
    const events = [evidence(1, 23), evidence(2, 21), evidence(3, 10)];
    const review = reviewLeaderScore(context, events, proposal(value));
    expect(review.lowerEvidenceIds).toEqual(events.filter(e => e.result.value > value).map(e => e.id));
    const entry = decision(events, proposal(value)); delete entry.review.lowerConfirmed;
    expect(() => resolveScoreReview(context, [...events, entry])).toThrow("Explicitly confirm");
  });
  it.each([23, 30])("equal/higher proposal %s needs ordinary confirmation only", value => {
    const events = [evidence(1, 23)]; const entry = decision(events, proposal(value)); delete entry.review.lowerConfirmed;
    expect(entry.review.lowerEvidenceIds).toEqual([]);
    expect(resolveScoreReview(context, [...events, entry]).accepted).toBe(entry);
  });
  it("retains rejected erroneous evidence but removes it from later comparison floors", () => {
    const events: ScoreReviewEvent[] = [evidence(1, 999999)];
    const p = proposal(23, [rejected("member-1")]);
    expect(reviewLeaderScore(context, events, p).lowerEvidenceIds).toEqual(["member-1"]);
    events.push(decision(events, p));
    expect(resolveScoreReview(context, events).pending).toEqual([]);
    expect(events[0]).toEqual(evidence(1, 999999));
    expect(reviewLeaderScore(context, events, proposal(24)).lowerEvidenceIds).toEqual([]);
    expect(resolveScoreReview(context, events, 1).pending).toHaveLength(1);
  });
  it("does not hide unresolved higher evidence behind a lower or later observation", () => {
    const events: ScoreReviewEvent[] = [evidence(1, 50), evidence(2, 20)];
    events.push(decision(events, proposal(25, [{ evidenceId: "member-2", outcome: "considered", reason: "Reviewed against current capture" }])));
    expect(reviewLeaderScore(context, events, proposal(30)).lowerEvidenceIds).toEqual(["member-1"]);
  });
  it("rejects stale review after any additional member evidence, even a lower result", () => {
    const events: ScoreReviewEvent[] = [evidence(1, 23)]; const entry = decision(events, proposal(20));
    events.push(evidence(2, 1)); entry.revision = 3;
    expect(() => resolveScoreReview(context, [...events, entry])).toThrow("review changed");
  });
  it.each(["value", "sourceId", "capturedAt", "finality", "resolutions"] as const)("invalidates confirmation when %s changes", field => {
    const events = [evidence(1, 23)]; const entry = decision(events, proposal(20));
    if (field === "value") entry.proposal.result.value = 21;
    if (field === "sourceId") entry.proposal.result.sourceId = "replacement-image";
    if (field === "capturedAt") entry.proposal.result.capturedAt = "2026-11-17T20:00:00Z";
    if (field === "finality") entry.proposal.result.finality = { kind: "unknown" };
    if (field === "resolutions") entry.proposal.resolutions = [rejected("member-1")];
    expect(() => resolveScoreReview(context, [...events, entry])).toThrow("review changed");
  });
  it.each(["allianceId", "memberId", "metricId", "unit", "windowId"] as const)("never compares across %s", field => {
    const different = { ...context, [field]: "another" };
    expect(() => resolveScoreReview(context, [{ ...evidence(1, 23), context: different }])).toThrow("Different result context");
    expect(() => reviewLeaderScore(context, [], { ...proposal(1), context: different })).toThrow("Different result context");
  });
  it.each(["unknown", "in-progress"] as const)("never promotes %s to final through arrival or leadership authority", kind => {
    const events: ScoreReviewEvent[] = [evidence(1, 23, { kind })];
    events.push(decision(events, proposal(25, [], { kind })));
    expect(resolveScoreReview(context, events).accepted?.proposal.result.finality).toEqual({ kind });
  });
  it("surfaces final evidence conflicts and refuses a downgrade until that policy is qualified", () => {
    const events = [evidence(1, 23, { kind: "final", evidenceId: "qualified-completed-window" })];
    const p = proposal(30);
    expect(reviewLeaderScore(context, events, p).finalityConflictIds).toEqual(["member-1"]);
    expect(() => resolveScoreReview(context, [...events, decision(events, p)])).toThrow("finality conflict");
  });
  it("also protects a leader-established final result from a progress replacement", () => {
    const events: ScoreReviewEvent[] = [decision([], proposal(20, [], { kind: "final", evidenceId: "qualified-final-review" }))];
    expect(reviewLeaderScore(context, events, proposal(25)).finalityConflictIds).toEqual(["leader-1"]);
    expect(() => resolveScoreReview(context, [...events, decision(events, proposal(25))])).toThrow("finality conflict");
  });
  it("uses committed revisions for as-known prefixes, not supplied capture time", () => {
    const events: ScoreReviewEvent[] = [evidence(1, 10)]; events.push(decision(events, proposal(12)));
    const late = evidence(3, 50); late.result.capturedAt = "2020-01-01T00:00:00Z"; events.push(late);
    expect(resolveScoreReview(context, events, 1).accepted).toBeNull();
    expect(resolveScoreReview(context, events, 2).pending).toHaveLength(1);
    expect(resolveScoreReview(context, events, 3).accepted?.proposal.result.value).toBe(12);
    expect(resolveScoreReview(context, events, 0)).toEqual({ revision: 0, accepted: null, pending: [] });
  });
  it("rejects duplicates, missing revisions, forged role, absent confirmation and truncated histories", () => {
    expect(() => resolveScoreReview(context, [evidence(2, 1)])).toThrow("contiguous");
    expect(() => resolveScoreReview(context, [evidence(1, 1), { ...evidence(2, 1), id: "member-1" }])).toThrow("unique");
    const entry = decision([], proposal(1)); entry.actor.role = "MEMBER";
    expect(() => resolveScoreReview(context, [entry])).toThrow("authority");
    const unconfirmed = decision([], proposal(1)); unconfirmed.review.confirmed = false as never;
    expect(() => resolveScoreReview(context, [unconfirmed])).toThrow("confirm again");
    expect(() => resolveScoreReview(context, [], 1)).toThrow("history");
  });
  it.each([NaN, Infinity, -1, Number.MAX_SAFE_INTEGER + 1])("rejects invalid numeric value %s", value => {
    expect(() => resolveScoreReview(context, [evidence(1, value)])).toThrow("score value");
  });
  it("rejects unknown, repeated or unexplained evidence resolutions", () => {
    const events = [evidence(1, 10)];
    for (const resolutions of [[rejected("wrong")], [rejected("member-1"), rejected("member-1")], [{ ...rejected("member-1"), reason: "" }]]) {
      expect(() => reviewLeaderScore(context, events, proposal(12, resolutions))).toThrow();
    }
  });
});
