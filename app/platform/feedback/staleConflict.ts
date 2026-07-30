import type { StaleConflictPayload } from "@/app/src/lib/feedbackTriage";

export type TriageBaseline = {
  status: StaleConflictPayload["status"];
  needsResponse: boolean;
  githubIssueUrl: string | null;
  stateRevision: number;
};

/** Applies authoritative conflict state as the new edit baseline. */
export function applyConflictBaseline(
  payload: StaleConflictPayload,
): TriageBaseline {
  return {
    status: payload.status,
    needsResponse: payload.needsResponse,
    githubIssueUrl: payload.githubIssueUrl,
    stateRevision: payload.stateRevision,
  };
}
