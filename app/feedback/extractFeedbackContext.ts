/**
 * Pure helper: pull the alliance/period identifiers out of a feedback URL.
 *
 * Feedback is submitted with the page path (e.g. `/alliances/{id}/periods/{id}/import`).
 * The notifier uses these ids to resolve human-friendly names for the operator
 * email. Kept separate and pure so the notifier reads declaratively
 * (extract -> resolve -> send) and the parsing is easy to unit test.
 */
export type FeedbackContext = {
  allianceId?: string;
  periodId?: string;
};

export function extractFeedbackContext(url: string): FeedbackContext {
  const context: FeedbackContext = {};

  const alliance = url.match(/\/alliances\/([^/?#]+)/);
  if (alliance) {
    context.allianceId = alliance[1];
  }

  const period = url.match(/\/periods\/([^/?#]+)/);
  if (period) {
    context.periodId = period[1];
  }

  return context;
}
