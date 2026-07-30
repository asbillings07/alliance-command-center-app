const GLOBAL_FAILURE_COUNT_KEY = "__feedbackInboxListQueryFailuresRemaining";

function readFailureCount(): number {
  const value = (globalThis as Record<string, unknown>)[GLOBAL_FAILURE_COUNT_KEY];
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function writeFailureCount(count: number): void {
  (globalThis as Record<string, unknown>)[GLOBAL_FAILURE_COUNT_KEY] = count;
}

/**
 * Integration/E2E hook: fail the next N inbox list/filter-option queries (#176).
 * Counter lives on globalThis so API routes and bundled server modules share state.
 */
export function setFeedbackInboxListQueryFailuresRemaining(count: number): void {
  writeFailureCount(Math.max(0, count));
}

export function clearFeedbackInboxTestHooks(): void {
  writeFailureCount(0);
}

export async function runFeedbackInboxListQueryFailureHook(): Promise<void> {
  const remaining = readFailureCount();
  if (remaining > 0) {
    writeFailureCount(remaining - 1);
    throw new Error("FEEDBACK_INBOX_TEST_HOOK: simulated inbox query failure");
  }
}
