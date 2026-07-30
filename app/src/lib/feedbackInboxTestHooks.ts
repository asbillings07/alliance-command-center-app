let listQueryFailuresRemaining = 0;

/**
 * Integration/E2E hook: fail the next N inbox list/filter-option queries (#176).
 * Active only when `FEEDBACK_INBOX_TEST_HOOKS=true`.
 */
export function setFeedbackInboxListQueryFailuresRemaining(count: number): void {
  listQueryFailuresRemaining = Math.max(0, count);
}

export function clearFeedbackInboxTestHooks(): void {
  listQueryFailuresRemaining = 0;
}

export async function runFeedbackInboxListQueryFailureHook(): Promise<void> {
  if (process.env.FEEDBACK_INBOX_TEST_HOOKS !== "true") {
    return;
  }
  if (listQueryFailuresRemaining > 0) {
    listQueryFailuresRemaining -= 1;
    throw new Error("FEEDBACK_INBOX_TEST_HOOK: simulated inbox query failure");
  }
}
