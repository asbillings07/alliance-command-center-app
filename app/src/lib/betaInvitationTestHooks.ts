export type BetaInvitationLockOperation = "claim" | "revoke" | "reissue";

export type BetaInvitationLockContext = {
  participantId: string;
  operation: BetaInvitationLockOperation;
};

let afterParticipantLockHook:
  | ((context: BetaInvitationLockContext) => Promise<void>)
  | null = null;

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
  afterParticipantLockHook = null;
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
