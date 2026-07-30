export type FeedbackTriageLockOperation = "stateChange" | "note";

export type FeedbackTriageLockContext = {
  feedbackId: string;
  operation: FeedbackTriageLockOperation;
};

let beforeTriageLockHook:
  | ((context: FeedbackTriageLockContext) => Promise<void>)
  | null = null;
let afterTriageLockHook:
  | ((context: FeedbackTriageLockContext) => Promise<void>)
  | null = null;

/**
 * Integration-test hook invoked immediately before `SELECT … FOR UPDATE` on
 * FeedbackTriage (#176). Active only when `FEEDBACK_TRIAGE_TEST_HOOKS=true`.
 */
export function setFeedbackTriageBeforeLockHook(
  hook: ((context: FeedbackTriageLockContext) => Promise<void>) | null,
): void {
  beforeTriageLockHook = hook;
}

/**
 * Integration-test hook invoked after `SELECT … FOR UPDATE` on FeedbackTriage
 * and before the mutating step (#176). Active only when
 * `FEEDBACK_TRIAGE_TEST_HOOKS=true`.
 */
export function setFeedbackTriageAfterLockHook(
  hook: ((context: FeedbackTriageLockContext) => Promise<void>) | null,
): void {
  afterTriageLockHook = hook;
}

export function clearFeedbackTriageTestHooks(): void {
  beforeTriageLockHook = null;
  afterTriageLockHook = null;
}

export async function runFeedbackTriageBeforeLockHook(
  context: FeedbackTriageLockContext,
): Promise<void> {
  if (
    process.env.FEEDBACK_TRIAGE_TEST_HOOKS === "true" &&
    beforeTriageLockHook
  ) {
    await beforeTriageLockHook(context);
  }
}

export async function runFeedbackTriageAfterLockHook(
  context: FeedbackTriageLockContext,
): Promise<void> {
  if (
    process.env.FEEDBACK_TRIAGE_TEST_HOOKS === "true" &&
    afterTriageLockHook
  ) {
    await afterTriageLockHook(context);
  }
}
