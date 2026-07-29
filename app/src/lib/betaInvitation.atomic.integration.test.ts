import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as BetaInvitationModule from "./betaInvitation";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

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
});
