/**
 * Offline qualification contract (#400), not an authorization or persistence API.
 * Callers must admit evidence and actors on the server before using these types.
 * No production reader/writer imports this module yet.
 */
export type ScoreContext = {
  allianceId: string; memberId: string; metricId: string; unit: string; windowId: string;
};
export type ScoreFinality =
  | { kind: "unknown" | "in-progress" }
  | { kind: "final"; evidenceId: string };
export type ScoreResult = { value: number; finality: ScoreFinality; sourceId: string; capturedAt: string | null };
export type ScoreActor = { userId: string; name: string; role: "MEMBER" | "OWNER" | "ADMIN" | "LEADER" };
export type MemberEvidence = {
  kind: "member-evidence"; id: string; revision: number; context: ScoreContext;
  actor: ScoreActor; result: ScoreResult;
};
export type EvidenceResolution = { evidenceId: string; outcome: "considered" | "rejected"; reason: string };
export type LeaderProposal = { context: ScoreContext; result: ScoreResult; resolutions: EvidenceResolution[] };
export type ScoreReview = {
  // Exact comparison receipt, not a secret or permission grant.
  key: string; lowerEvidenceIds: string[]; finalityConflictIds: string[];
};
export type LeaderDecision = {
  kind: "leader-decision"; id: string; revision: number; context: ScoreContext;
  actor: ScoreActor; proposal: LeaderProposal;
  review: { key: string; lowerEvidenceIds: string[]; finalityConflictIds: string[]; confirmed: true; lowerConfirmed?: true };
};
export type ScoreReviewEvent = MemberEvidence | LeaderDecision;
export type ScoreState = {
  revision: number; accepted: LeaderDecision | null; pending: MemberEvidence[];
};

const contextKey = (c: ScoreContext) => JSON.stringify([c.allianceId, c.memberId, c.metricId, c.unit, c.windowId]);
const finalityKey = (f: ScoreFinality) => [f.kind, f.kind === "final" ? f.evidenceId : null];
const resultKey = (r: ScoreResult) => [r.value, finalityKey(r.finality), r.sourceId, r.capturedAt];
function requireText(value: string) {
  if (typeof value !== "string" || !value.trim() || value.length > 300) throw new Error("Invalid score context or evidence reference.");
}
function validateContext(context: ScoreContext) {
  for (const value of [context.allianceId, context.memberId, context.metricId, context.unit, context.windowId]) requireText(value);
}
function validateResult(result: ScoreResult) {
  if (!Number.isFinite(result.value) || result.value < 0 || result.value > Number.MAX_SAFE_INTEGER) throw new Error("Invalid score value.");
  requireText(result.sourceId);
  if (result.capturedAt !== null && (typeof result.capturedAt !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(result.capturedAt) || !Number.isFinite(Date.parse(result.capturedAt)))) throw new Error("Invalid capture time.");
  if (!["unknown", "in-progress", "final"].includes(result.finality.kind)) throw new Error("Unknown finality.");
  if (result.finality.kind === "final") requireText(result.finality.evidenceId);
}
function validateActor(actor: ScoreActor, leadership: boolean) {
  requireText(actor.userId); requireText(actor.name);
  const allowed = leadership ? ["OWNER", "ADMIN", "LEADER"] : ["MEMBER", "OWNER", "ADMIN", "LEADER"];
  if (!allowed.includes(actor.role)) throw new Error("Invalid action-time authority.");
}
function comparison(context: ScoreContext, state: ScoreState, proposal: LeaderProposal): ScoreReview {
  validateResult(proposal.result);
  if (contextKey(context) !== contextKey(proposal.context)) throw new Error("Different result context.");
  const ids = new Set<string>();
  for (const resolution of proposal.resolutions) {
    if (ids.has(resolution.evidenceId) || !state.pending.some(e => e.id === resolution.evidenceId)) throw new Error("Resolution must name distinct pending evidence.");
    if (!["considered", "rejected"].includes(resolution.outcome)) throw new Error("Invalid evidence resolution.");
    requireText(resolution.reason); ids.add(resolution.evidenceId);
  }
  // Even evidence proposed for rejection stays in the warning until committed.
  const lowerEvidenceIds = state.pending.filter(e => e.result.value > proposal.result.value).map(e => e.id);
  const finalSources = state.pending.filter(e => e.result.finality.kind === "final").map(e => e.id);
  if (state.accepted?.proposal.result.finality.kind === "final") finalSources.push(state.accepted.id);
  const finalityConflictIds = proposal.result.finality.kind === "final" ? [] : finalSources;
  const key = JSON.stringify([contextKey(context), state.revision, state.accepted?.id ?? null,
    state.pending.map(e => [e.id, resultKey(e.result)]), resultKey(proposal.result),
    proposal.resolutions.map(r => [r.evidenceId, r.outcome, r.reason])]);
  return { key, lowerEvidenceIds, finalityConflictIds };
}

/** Replay a complete contiguous, committed per-context prefix, never wall time. */
export function resolveScoreReview(context: ScoreContext, events: readonly ScoreReviewEvent[], cutoff = events.length): ScoreState {
  validateContext(context);
  if (events.length > 1000 || !Number.isSafeInteger(cutoff) || cutoff < 0 || cutoff > events.length) throw new Error("Invalid or oversized review history.");
  const state: ScoreState = { revision: 0, accepted: null, pending: [] };
  const ids = new Set<string>();
  for (const event of events.slice(0, cutoff)) {
    requireText(event.id); validateContext(event.context);
    if (ids.has(event.id) || event.revision !== state.revision + 1) throw new Error("History must have unique events and contiguous committed revisions.");
    if (contextKey(event.context) !== contextKey(context)) throw new Error("Different result context.");
    ids.add(event.id);
    if (event.kind === "member-evidence") {
      validateActor(event.actor, false); validateResult(event.result);
      state.pending.push(event);
    } else if (event.kind === "leader-decision") {
      validateActor(event.actor, true);
      const review = comparison(context, state, event.proposal);
      if (event.review.confirmed !== true || event.review.key !== review.key
        || JSON.stringify(event.review.lowerEvidenceIds) !== JSON.stringify(review.lowerEvidenceIds)
        || JSON.stringify(event.review.finalityConflictIds) !== JSON.stringify(review.finalityConflictIds)) throw new Error("Score review changed; review and confirm again.");
      if (review.lowerEvidenceIds.length && event.review.lowerConfirmed !== true) throw new Error("Explicitly confirm the lower score comparison.");
      // A downgrade of final evidence needs the still-unqualified finality policy.
      if (review.finalityConflictIds.length) throw new Error("Resolve the finality conflict before accepting this decision.");
      state.accepted = event;
      const resolved = new Set(event.proposal.resolutions.map(r => r.evidenceId));
      state.pending = state.pending.filter(e => !resolved.has(e.id));
    } else throw new Error("Unknown score review event.");
    state.revision = event.revision;
  }
  return state;
}

export function reviewLeaderScore(context: ScoreContext, events: readonly ScoreReviewEvent[], proposal: LeaderProposal): ScoreReview {
  return comparison(context, resolveScoreReview(context, events), proposal);
}
