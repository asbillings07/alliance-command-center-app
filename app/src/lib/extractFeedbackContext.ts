/**
 * Pure helper: pull the alliance/period identifiers out of a feedback URL.
 *
 * Feedback is submitted with the page path (e.g. `/alliances/{id}/periods/{id}/import`).
 * Used when persisting alliance context and when building operator notifications.
 * Kept separate and pure so callers read declaratively (extract -> resolve -> act)
 * and the parsing is easy to unit test.
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
