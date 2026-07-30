/** Canonical GitHub issue URL: https://github.com/{owner}/{repo}/issues/{number} */
export const GITHUB_ISSUE_URL_PATTERN =
  /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/\d+$/;

export function validateGithubIssueUrl(url: string): boolean {
  return GITHUB_ISSUE_URL_PATTERN.test(url);
}
