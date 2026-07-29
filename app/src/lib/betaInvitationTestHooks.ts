export type BetaInvitationLockOperation = "claim" | "revoke" | "reissue";

export type BetaInvitationLockContext = {
  participantId: string;
  operation: BetaInvitationLockOperation;
};

let beforeParticipantLockHook:
  | ((context: BetaInvitationLockContext) => Promise<void>)
  | null = null;
let afterParticipantLockHook:
  | ((context: BetaInvitationLockContext) => Promise<void>)
  | null = null;

/**
 * Integration-test hook invoked immediately before `SELECT … FOR UPDATE` on
 * BetaParticipant (#174). Active only when `BETA_INVITATION_TEST_HOOKS=true`.
 */
export function setBetaInvitationBeforeParticipantLockHook(
  hook: ((context: BetaInvitationLockContext) => Promise<void>) | null,
): void {
  beforeParticipantLockHook = hook;
}

/**
 * Integration-test hook invoked after `SELECT … FOR UPDATE` on BetaParticipant
 * and before the mutating step (#174). Active only when
 * `BETA_INVITATION_TEST_HOOKS=true`.
 */
export function setBetaInvitationAfterParticipantLockHook(
  hook: ((context: BetaInvitationLockContext) => Promise<void>) | null,
): void {
  afterParticipantLockHook = hook;
}

export function clearBetaInvitationTestHooks(): void {
  beforeParticipantLockHook = null;
  afterParticipantLockHook = null;
}

export async function runBetaInvitationBeforeParticipantLockHook(
  context: BetaInvitationLockContext,
): Promise<void> {
  if (
    process.env.BETA_INVITATION_TEST_HOOKS === "true" &&
    beforeParticipantLockHook
  ) {
    await beforeParticipantLockHook(context);
  }
}

export async function runBetaInvitationAfterParticipantLockHook(
  context: BetaInvitationLockContext,
): Promise<void> {
  if (
    process.env.BETA_INVITATION_TEST_HOOKS === "true" &&
    afterParticipantLockHook
  ) {
    await afterParticipantLockHook(context);
  }
}
