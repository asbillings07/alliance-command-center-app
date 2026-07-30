/** Canonical GitHub issue URL: https://github.com/{owner}/{repo}/issues/{number} */
export const GITHUB_ISSUE_URL_PATTERN =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/;

export function validateGithubIssueUrl(url: string): boolean {
  return GITHUB_ISSUE_URL_PATTERN.test(url);
}

/** Client-safe stale-conflict payload shape for triage recovery UI. */
export type StaleConflictPayload = {
  status: "NEW" | "TRIAGED" | "PLANNED" | "RESOLVED" | "DISMISSED";
  needsResponse: boolean;
  githubIssueUrl: string | null;
  stateRevision: number;
  lastStateChangeAt: Date | null;
  lastStateChangeActorEmail: string | null;
  lastStateChangeActorDisplayName: string | null;
};

export type TriageBaseline = Pick<
  StaleConflictPayload,
  "status" | "needsResponse" | "githubIssueUrl" | "stateRevision"
>;

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
