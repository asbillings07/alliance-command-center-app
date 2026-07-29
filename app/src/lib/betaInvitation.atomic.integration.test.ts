import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as BetaInvitationModule from "./betaInvitation";
import {
  clearBetaInvitationTestHooks,
  setBetaInvitationAfterParticipantLockHook,
  setBetaInvitationBeforeParticipantLockHook,
} from "./betaInvitationTestHooks";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function enableBarrierHooks() {
  process.env.BETA_INVITATION_TEST_HOOKS = "true";
}

async function findLatestInvitation(
  prismaClient: PrismaClient,
  participantId: string,
) {
  return prismaClient.betaInvitation.findFirst({
    where: { participantId },
    orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
  });
}

describeIntegration("betaInvitation atomic actions [integration]", () => {
  const createdUserIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];

  let prisma: PrismaClient;
  let issueBetaInvitation: typeof BetaInvitationModule.issueBetaInvitation;
  let reissueBetaInvitation: typeof BetaInvitationModule.reissueBetaInvitation;
  let revokeBetaInvitation: typeof BetaInvitationModule.revokeBetaInvitation;
  let claimBetaInvitationResend: typeof BetaInvitationModule.claimBetaInvitationResend;
  let releaseBetaInvitationResend: typeof BetaInvitationModule.releaseBetaInvitationResend;
  let BETA_RESEND_CLAIM_LEASE_MS: number;

  beforeAll(async () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    ({ prisma } = (await import("./prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({
      issueBetaInvitation,
      reissueBetaInvitation,
      revokeBetaInvitation,
      claimBetaInvitationResend,
      releaseBetaInvitationResend,
      BETA_RESEND_CLAIM_LEASE_MS,
    } = await import("./betaInvitation"));
  });

  afterEach(async () => {
    clearBetaInvitationTestHooks();
    delete process.env.BETA_INVITATION_TEST_HOOKS;
    if (createdInvitationIds.length > 0) {
      await prisma.betaInvitation.deleteMany({
        where: { id: { in: createdInvitationIds } },
      });
      createdInvitationIds.length = 0;
    }
    if (createdParticipantIds.length > 0) {
      await prisma.betaParticipant.deleteMany({
        where: { id: { in: createdParticipantIds } },
      });
      createdParticipantIds.length = 0;
    }
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      createdUserIds.length = 0;
    }
  });

  async function makeOperator() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `beta-operator-${suffix}@example.test`,
        displayName: "Beta Operator",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function issueTracked(email?: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await issueBetaInvitation(
      email ?? `beta-atomic-${suffix}@example.test`,
      { campaign: "Wave A", notes: "Original notes" },
    );
    createdInvitationIds.push(result.invitation.id);
    createdParticipantIds.push(result.invitation.participantId);
    return result.invitation;
  }

  it("rejects generic invite when participant already exists without pending attempt", async () => {
    const email = `existing-participant-${Date.now()}@example.test`;
    const first = await issueTracked(email);

    await prisma.betaInvitation.update({
      where: { id: first.id },
      data: { revokedAt: new Date() },
    });

    await expect(issueBetaInvitation(email)).rejects.toThrow(
      "This person is already a beta participant — use Reissue",
    );
  });

  it("reissues with wave carry-forward, blank wave, and no notes copied", async () => {
    const operator = await makeOperator();
    const invitation = await issueTracked();

    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: {
        revokedAt: new Date(),
        campaign: "Wave carry",
        notes: "Do not copy",
      },
    });

    const reissued = await reissueBetaInvitation(
      invitation.participantId,
      operator.id,
    );
    createdInvitationIds.push(reissued.invitation.id);

    expect(reissued.invitation.campaign).toBe("Wave carry");
    expect(reissued.invitation.notes).toBeNull();
    expect(reissued.invitation.reissuedFromInvitationId).toBe(invitation.id);
    expect(reissued.invitation.issuedByUserId).toBe(operator.id);

    const prior = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(prior?.notes).toBe("Do not copy");
    expect(prior?.revokedAt).not.toBeNull();
  });

  it("keeps wave blank when the revoked source attempt had no wave", async () => {
    const operator = await makeOperator();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await issueBetaInvitation(`blank-wave-${suffix}@example.test`);
    const invitation = result.invitation;
    createdInvitationIds.push(invitation.id);
    createdParticipantIds.push(invitation.participantId);

    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { revokedAt: new Date(), campaign: null },
    });

    const reissued = await reissueBetaInvitation(
      invitation.participantId,
      operator.id,
    );
    createdInvitationIds.push(reissued.invitation.id);
    expect(reissued.invitation.campaign).toBeNull();
  });

  it("creates exactly one reissue under concurrent attempts", async () => {
    const operator = await makeOperator();
    const invitation = await issueTracked();

    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 86400000) },
    });

    const results = await Promise.allSettled([
      reissueBetaInvitation(invitation.participantId, operator.id),
      reissueBetaInvitation(invitation.participantId, operator.id),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    if (fulfilled[0]?.status === "fulfilled") {
      createdInvitationIds.push(fulfilled[0].value.invitation.id);
    }

    const successors = await prisma.betaInvitation.findMany({
      where: { reissuedFromInvitationId: invitation.id },
    });
    expect(successors).toHaveLength(1);
  });

  it("rejects resend and revoke against non-latest attempt ids", async () => {
    const operator = await makeOperator();
    const first = await issueTracked();

    await prisma.betaInvitation.update({
      where: { id: first.id },
      data: { revokedAt: new Date() },
    });

    const second = await reissueBetaInvitation(first.participantId, operator.id);
    createdInvitationIds.push(second.invitation.id);

    await expect(claimBetaInvitationResend(first.id)).rejects.toThrow(
      "latest invitation attempt",
    );
    await expect(revokeBetaInvitation(first.id, operator.id)).rejects.toThrow(
      "latest invitation attempt",
    );
  });

  it("fails revoke while resend claim is active, then succeeds after release", async () => {
    const invitation = await issueTracked();

    const claim = await claimBetaInvitationResend(invitation.id);

    await expect(revokeBetaInvitation(invitation.id)).rejects.toThrow(
      "A delivery attempt is in progress",
    );

    await releaseBetaInvitationResend(invitation.id, claim.claimId);

    await expect(revokeBetaInvitation(invitation.id)).resolves.toBeUndefined();
  });

  it("does not clear a superseding resend claim on delayed release", async () => {
    const invitation = await issueTracked();
    const claimA = "claim-a-test";
    const staleClaimTime = new Date(
      Date.now() - BETA_RESEND_CLAIM_LEASE_MS - 1000,
    );

    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: {
        resendClaimedAt: staleClaimTime,
        resendClaimId: claimA,
      },
    });

    const claim = await claimBetaInvitationResend(invitation.id);
    expect(claim.claimId).not.toBe(claimA);

    await releaseBetaInvitationResend(invitation.id, claimA);

    const row = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(row?.resendClaimId).toBe(claim.claimId);
    expect(row?.resendClaimedAt).not.toBeNull();

    await releaseBetaInvitationResend(invitation.id, claim.claimId);
  });

  it("rejects reissue when participant identity is ambiguous but allows revoke", async () => {
    const operator = await makeOperator();
    const invitation = await issueTracked();

    await prisma.betaParticipant.update({
      where: { id: invitation.participantId },
      data: { identityAmbiguous: true },
    });

    await expect(
      reissueBetaInvitation(invitation.participantId, operator.id),
    ).rejects.toThrow("identity is ambiguous");

    await expect(revokeBetaInvitation(invitation.id, operator.id)).resolves.toBeUndefined();
  });

  it("rejects reissue while a live resend claim exists even if the attempt is expired", async () => {
    const operator = await makeOperator();
    const invitation = await issueTracked();

    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: {
        expiresAt: new Date(Date.now() - 1000),
        resendClaimedAt: new Date(),
        resendClaimId: "live-claim-test",
      },
    });

    await expect(
      reissueBetaInvitation(invitation.participantId, operator.id),
    ).rejects.toThrow("A delivery attempt is in progress for the latest invitation");
  });

  it("rejects resend claim when a newer attempt already exists", async () => {
    const operator = await makeOperator();
    const first = await issueTracked();

    await prisma.betaInvitation.update({
      where: { id: first.id },
      data: { revokedAt: new Date() },
    });

    const second = await reissueBetaInvitation(first.participantId, operator.id);
    createdInvitationIds.push(second.invitation.id);

    await expect(claimBetaInvitationResend(first.id)).rejects.toThrow(
      "latest invitation attempt",
    );
  });

  it("rejects revoke on a superseded attempt after reissue", async () => {
    const operator = await makeOperator();
    const first = await issueTracked();

    await prisma.betaInvitation.update({
      where: { id: first.id },
      data: { revokedAt: new Date() },
    });

    const second = await reissueBetaInvitation(first.participantId, operator.id);
    createdInvitationIds.push(second.invitation.id);

    await expect(revokeBetaInvitation(first.id, operator.id)).rejects.toThrow(
      "latest invitation attempt",
    );
  });

  it("revoke wins over an in-flight resend claim", async () => {
    const operator = await makeOperator();
    const invitation = await issueTracked();

    const claim = await claimBetaInvitationResend(invitation.id);

    await expect(revokeBetaInvitation(invitation.id, operator.id)).rejects.toThrow(
      "A delivery attempt is in progress",
    );

    await releaseBetaInvitationResend(invitation.id, claim.claimId);

    await expect(revokeBetaInvitation(invitation.id, operator.id)).resolves.toBeUndefined();
  });

  it("resend claim wins participant lock before concurrent reissue on a pending attempt", async () => {
    enableBarrierHooks();
    const operator = await makeOperator();
    const invitation = await issueTracked();
    const originalSnapshot = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });

    const claimLocked = createDeferred<void>();
    const releaseClaim = createDeferred<void>();
    const reissueAttemptingLock = createDeferred<void>();

    setBetaInvitationAfterParticipantLockHook(async (ctx) => {
      if (ctx.operation === "claim") {
        claimLocked.resolve(undefined);
        await releaseClaim.promise;
      }
    });
    setBetaInvitationBeforeParticipantLockHook(async (ctx) => {
      if (ctx.operation === "reissue") {
        reissueAttemptingLock.resolve(undefined);
      }
    });

    const claimPromise = claimBetaInvitationResend(invitation.id);
    await claimLocked.promise;

    const reissuePromise = reissueBetaInvitation(
      invitation.participantId,
      operator.id,
    );
    await reissueAttemptingLock.promise;

    releaseClaim.resolve(undefined);
    const claim = await claimPromise;

    await expect(reissuePromise).rejects.toThrow(
      "Cannot reissue while the latest attempt is still pending",
    );

    const latest = await findLatestInvitation(prisma, invitation.participantId);
    expect(latest?.id).toBe(invitation.id);

    const row = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(row?.resendClaimId).toBe(claim.claimId);
    expect(row?.resendClaimedAt).not.toBeNull();
    expect(row?.revokedAt).toBeNull();
    expect(row?.notes).toBe(originalSnapshot?.notes);
    expect(row?.campaign).toBe(originalSnapshot?.campaign);

    await releaseBetaInvitationResend(claim.invitationId, claim.claimId);
  });

  it("revoke wins participant lock before concurrent reissue on a pending attempt", async () => {
    enableBarrierHooks();
    const operator = await makeOperator();
    const invitation = await issueTracked();
    const originalSnapshot = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });

    const revokeLocked = createDeferred<void>();
    const releaseRevoke = createDeferred<void>();
    const reissueAttemptingLock = createDeferred<void>();

    setBetaInvitationAfterParticipantLockHook(async (ctx) => {
      if (ctx.operation === "revoke") {
        revokeLocked.resolve(undefined);
        await releaseRevoke.promise;
      }
    });
    setBetaInvitationBeforeParticipantLockHook(async (ctx) => {
      if (ctx.operation === "reissue") {
        reissueAttemptingLock.resolve(undefined);
      }
    });

    const revokePromise = revokeBetaInvitation(invitation.id, operator.id);
    await revokeLocked.promise;

    const reissuePromise = reissueBetaInvitation(
      invitation.participantId,
      operator.id,
    )
      .then((result) => {
        createdInvitationIds.push(result.invitation.id);
        return result;
      });
    await reissueAttemptingLock.promise;

    releaseRevoke.resolve(undefined);
    await revokePromise;

    const reissued = await reissuePromise;
    expect(reissued.invitation.reissuedFromInvitationId).toBe(invitation.id);

    const original = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(original?.revokedAt).not.toBeNull();
    expect(original?.revokedByUserId).toBe(operator.id);
    expect(original?.notes).toBe(originalSnapshot?.notes);
    expect(original?.campaign).toBe(originalSnapshot?.campaign);
    expect(original?.resendClaimId).toBeNull();

    const latest = await findLatestInvitation(prisma, invitation.participantId);
    expect(latest?.id).toBe(reissued.invitation.id);
    expect(latest?.resendClaimId).toBeNull();
  });

  it("live resend claim blocks reissue after expiry until claim is released", async () => {
    enableBarrierHooks();
    const operator = await makeOperator();
    const invitation = await issueTracked();
    const originalSnapshot = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });

    const claim = await claimBetaInvitationResend(invitation.id);

    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const reissueLocked = createDeferred<void>();
    const releaseReissue = createDeferred<void>();

    setBetaInvitationAfterParticipantLockHook(async (ctx) => {
      if (ctx.operation === "reissue") {
        reissueLocked.resolve(undefined);
        await releaseReissue.promise;
      }
    });

    const blockedReissue = reissueBetaInvitation(
      invitation.participantId,
      operator.id,
    );
    await reissueLocked.promise;

    const rowBeforeRelease = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(rowBeforeRelease?.resendClaimId).toBe(claim.claimId);
    expect(rowBeforeRelease?.expiresAt.getTime()).toBeLessThan(Date.now());

    releaseReissue.resolve(undefined);
    await expect(blockedReissue).rejects.toThrow(
      "A delivery attempt is in progress for the latest invitation",
    );

    expect(
      await prisma.betaInvitation.count({
        where: { reissuedFromInvitationId: invitation.id },
      }),
    ).toBe(0);

    const unchanged = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(unchanged?.notes).toBe(originalSnapshot?.notes);
    expect(unchanged?.campaign).toBe(originalSnapshot?.campaign);
    expect(unchanged?.revokedAt).toBeNull();
    expect(unchanged?.resendClaimId).toBe(claim.claimId);

    await releaseBetaInvitationResend(claim.invitationId, claim.claimId);

    const reissued = await reissueBetaInvitation(
      invitation.participantId,
      operator.id,
    );
    createdInvitationIds.push(reissued.invitation.id);

    expect(reissued.invitation.reissuedFromInvitationId).toBe(invitation.id);
    const latest = await findLatestInvitation(prisma, invitation.participantId);
    expect(latest?.id).toBe(reissued.invitation.id);
    expect(latest?.resendClaimId).toBeNull();
  });

  it("revoke wins participant lock before concurrent resend claim on a pending attempt", async () => {
    enableBarrierHooks();
    const operator = await makeOperator();
    const invitation = await issueTracked();
    const originalSnapshot = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });

    const revokeLocked = createDeferred<void>();
    const releaseRevoke = createDeferred<void>();
    const claimAttemptingLock = createDeferred<void>();

    setBetaInvitationAfterParticipantLockHook(async (ctx) => {
      if (ctx.operation === "revoke") {
        revokeLocked.resolve(undefined);
        await releaseRevoke.promise;
      }
    });
    setBetaInvitationBeforeParticipantLockHook(async (ctx) => {
      if (ctx.operation === "claim") {
        claimAttemptingLock.resolve(undefined);
      }
    });

    const revokePromise = revokeBetaInvitation(invitation.id, operator.id);
    await revokeLocked.promise;

    const claimPromise = claimBetaInvitationResend(invitation.id);
    await claimAttemptingLock.promise;

    releaseRevoke.resolve(undefined);
    await revokePromise;

    await expect(claimPromise).rejects.toThrow(
      "Only pending invitations can be resent",
    );

    const row = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(row?.revokedAt).not.toBeNull();
    expect(row?.revokedByUserId).toBe(operator.id);
    expect(row?.resendClaimId).toBeNull();
    expect(row?.resendClaimedAt).toBeNull();
    expect(row?.notes).toBe(originalSnapshot?.notes);
    expect(row?.campaign).toBe(originalSnapshot?.campaign);

    const latest = await findLatestInvitation(prisma, invitation.participantId);
    expect(latest?.id).toBe(invitation.id);
  });

  it("resend claim wins participant lock before concurrent revoke on a pending attempt", async () => {
    enableBarrierHooks();
    const operator = await makeOperator();
    const invitation = await issueTracked();
    const originalSnapshot = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });

    const claimLocked = createDeferred<void>();
    const releaseClaim = createDeferred<void>();
    const revokeAttemptingLock = createDeferred<void>();

    setBetaInvitationAfterParticipantLockHook(async (ctx) => {
      if (ctx.operation === "claim") {
        claimLocked.resolve(undefined);
        await releaseClaim.promise;
      }
    });
    setBetaInvitationBeforeParticipantLockHook(async (ctx) => {
      if (ctx.operation === "revoke") {
        revokeAttemptingLock.resolve(undefined);
      }
    });

    const claimPromise = claimBetaInvitationResend(invitation.id);
    await claimLocked.promise;

    const revokePromise = revokeBetaInvitation(invitation.id, operator.id);
    await revokeAttemptingLock.promise;

    releaseClaim.resolve(undefined);
    const claim = await claimPromise;

    await expect(revokePromise).rejects.toThrow(
      "A delivery attempt is in progress",
    );

    const row = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(row?.revokedAt).toBeNull();
    expect(row?.revokedByUserId).toBeNull();
    expect(row?.resendClaimId).toBe(claim.claimId);
    expect(row?.resendClaimedAt).not.toBeNull();
    expect(row?.notes).toBe(originalSnapshot?.notes);
    expect(row?.campaign).toBe(originalSnapshot?.campaign);

    const latest = await findLatestInvitation(prisma, invitation.participantId);
    expect(latest?.id).toBe(invitation.id);

    await releaseBetaInvitationResend(claim.invitationId, claim.claimId);
  });

  it("reissue replacement wins before a late resend claim on a superseded attempt", async () => {
    enableBarrierHooks();
    const operator = await makeOperator();
    const invitation = await issueTracked();
    const originalSnapshot = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });

    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const reissueLocked = createDeferred<void>();
    const releaseReissue = createDeferred<void>();
    const claimAttemptingLock = createDeferred<void>();

    setBetaInvitationAfterParticipantLockHook(async (ctx) => {
      if (ctx.operation === "reissue") {
        reissueLocked.resolve(undefined);
        await releaseReissue.promise;
      }
    });
    setBetaInvitationBeforeParticipantLockHook(async (ctx) => {
      if (ctx.operation === "claim") {
        claimAttemptingLock.resolve(undefined);
      }
    });

    const reissuePromise = reissueBetaInvitation(
      invitation.participantId,
      operator.id,
    ).then((result) => {
      createdInvitationIds.push(result.invitation.id);
      return result;
    });
    await reissueLocked.promise;

    const claimPromise = claimBetaInvitationResend(invitation.id);
    await claimAttemptingLock.promise;

    releaseReissue.resolve(undefined);
    const reissued = await reissuePromise;

    await expect(claimPromise).rejects.toThrow("latest invitation attempt");

    expect(reissued.invitation.reissuedFromInvitationId).toBe(invitation.id);

    const original = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(original?.resendClaimId).toBeNull();
    expect(original?.resendClaimedAt).toBeNull();
    expect(original?.notes).toBe(originalSnapshot?.notes);
    expect(original?.campaign).toBe(originalSnapshot?.campaign);
    expect(original?.revokedAt).toBeNull();

    const latest = await findLatestInvitation(prisma, invitation.participantId);
    expect(latest?.id).toBe(reissued.invitation.id);
    expect(latest?.resendClaimId).toBeNull();
  });
});
