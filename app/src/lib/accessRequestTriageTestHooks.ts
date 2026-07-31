export type AccessRequestTriageLockOperation = "note" | "stateChange" | "convert";

export type AccessRequestTriageLockContext = {
  accessRequestId: string;
  operation: AccessRequestTriageLockOperation;
};

let beforeTriageLockHook:
  | ((context: AccessRequestTriageLockContext) => Promise<void>)
  | null = null;
let afterTriageLockHook:
  | ((context: AccessRequestTriageLockContext) => Promise<void>)
  | null = null;

/**
 * Integration-test hook invoked immediately before `SELECT … FOR UPDATE` on
 * AccessRequestTriage (#177). Active only when
 * `ACCESS_REQUEST_TRIAGE_TEST_HOOKS=true`.
 */
export function setAccessRequestTriageBeforeLockHook(
  hook: ((context: AccessRequestTriageLockContext) => Promise<void>) | null,
): void {
  beforeTriageLockHook = hook;
}

/**
 * Integration-test hook invoked after `SELECT … FOR UPDATE` on
 * AccessRequestTriage and before the mutating step (#177). Active only when
 * `ACCESS_REQUEST_TRIAGE_TEST_HOOKS=true`.
 */
export function setAccessRequestTriageAfterLockHook(
  hook: ((context: AccessRequestTriageLockContext) => Promise<void>) | null,
): void {
  afterTriageLockHook = hook;
}

export function clearAccessRequestTriageTestHooks(): void {
  beforeTriageLockHook = null;
  afterTriageLockHook = null;
}

export async function runAccessRequestTriageBeforeLockHook(
  context: AccessRequestTriageLockContext,
): Promise<void> {
  if (
    process.env.ACCESS_REQUEST_TRIAGE_TEST_HOOKS === "true" &&
    beforeTriageLockHook
  ) {
    await beforeTriageLockHook(context);
  }
}

export async function runAccessRequestTriageAfterLockHook(
  context: AccessRequestTriageLockContext,
): Promise<void> {
  if (
    process.env.ACCESS_REQUEST_TRIAGE_TEST_HOOKS === "true" &&
    afterTriageLockHook
  ) {
    await afterTriageLockHook(context);
  }
}
