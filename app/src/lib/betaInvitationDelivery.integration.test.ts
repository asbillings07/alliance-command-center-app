import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as BetaInvitationModule from "./betaInvitation";
import type { EmailResult } from "./email/types";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

/**
 * Real-Postgres coverage for #175 (invitation delivery history): the
 * persistence boundary in betaInvitation.ts, the claim's exactly-once
 * idempotency guarantee for attempt rows, and the migration's CHECK/FK
 * behavior — none of which a mocked-prisma unit test can prove.
 */
describeIntegration("betaInvitation delivery attempts [integration]", () => {
  const createdUserIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];

  let prisma: PrismaClient;
  let issueBetaInvitation: typeof BetaInvitationModule.issueBetaInvitation;
  let deliverBetaInvitationEmail: typeof BetaInvitationModule.deliverBetaInvitationEmail;
  let deliverBetaInvitationEmailWithClaim: typeof BetaInvitationModule.deliverBetaInvitationEmailWithClaim;
  let claimBetaInvitationResend: typeof BetaInvitationModule.claimBetaInvitationResend;
  let releaseBetaInvitationResend: typeof BetaInvitationModule.releaseBetaInvitationResend;

  beforeAll(async () => {
    process.env.NEXTAUTH_URL = "http://localhost:3000";
    ({ prisma } = (await import("./prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({
      issueBetaInvitation,
      deliverBetaInvitationEmail,
      deliverBetaInvitationEmailWithClaim,
      claimBetaInvitationResend,
      releaseBetaInvitationResend,
    } = await import("./betaInvitation"));
  });

  afterEach(async () => {
    // BetaInvitationDeliveryAttempt.invitationId is onDelete: Restrict —
    // this teardown order is itself load-bearing proof that Restrict is
    // real (see "Restrict" tests below, which assert the failure directly).
    if (createdInvitationIds.length > 0) {
      await prisma.betaInvitationDeliveryAttempt.deleteMany({
        where: { invitationId: { in: createdInvitationIds } },
      });
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

  async function makeOperator(email?: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: email ?? `beta-delivery-operator-${suffix}@example.test`,
        displayName: "Beta Delivery Operator",
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function issueTracked() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const result = await issueBetaInvitation(
      `beta-delivery-${suffix}@example.test`,
      { campaign: "Wave A" },
    );
    createdInvitationIds.push(result.invitation.id);
    createdParticipantIds.push(result.invitation.participantId);
    return result.invitation;
  }

  async function attemptsFor(invitationId: string) {
    return prisma.betaInvitationDeliveryAttempt.findMany({
      where: { invitationId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    });
  }

  it("persists a real SENT attempt with the actor's live email/display name snapshot", async () => {
    const operator = await makeOperator();
    const invitation = await issueTracked();
    const send = async () =>
      ({ status: "sent", messageId: "provider-msg-1" }) satisfies EmailResult;

    const status = await deliverBetaInvitationEmail(
      invitation,
      "https://example.test/redeem/tok",
      send,
      operator.id,
    );

    expect(status).toBe("sent");
    const attempts = await attemptsFor(invitation.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      trigger: "ISSUE",
      status: "SENT",
      providerMessageId: "provider-msg-1",
      failureReason: null,
      attemptedByUserId: operator.id,
      attemptedByEmail: operator.email,
      attemptedByDisplayName: operator.displayName,
    });
    expect(attempts[0].requestId).toBeTruthy();
  });

  it("persists a real FAILED resend attempt with a sanitized reason", async () => {
    const operator = await makeOperator();
    const invitation = await issueTracked();
    const send = async () =>
      ({ status: "failed", error: "Provider rejected the request" }) satisfies EmailResult;

    const status = await deliverBetaInvitationEmailWithClaim(
      invitation,
      "https://example.test/redeem/tok",
      send,
      operator.id,
      "resend",
    );

    expect(status).toBe("failed");
    const attempts = await attemptsFor(invitation.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]).toMatchObject({
      trigger: "RESEND",
      status: "FAILED",
      providerMessageId: null,
      failureReason: "Provider rejected the request",
    });

    // The claim must be fully released even though the send "failed" —
    // otherwise a real resend outage would permanently lock the invitation.
    const row = await prisma.betaInvitation.findUnique({
      where: { id: invitation.id },
    });
    expect(row?.resendClaimId).toBeNull();
    expect(row?.resendClaimedAt).toBeNull();
  });

  it("survives operator deletion: attribution snapshot remains, attemptedByUserId is nulled", async () => {
    const operator = await makeOperator();
    const invitation = await issueTracked();
    const send = async () => ({ status: "skipped" }) satisfies EmailResult;

    await deliverBetaInvitationEmail(
      invitation,
      "https://example.test/redeem/tok",
      send,
      operator.id,
    );

    await prisma.user.delete({ where: { id: operator.id } });
    createdUserIds.length = 0; // already deleted; don't try again in afterEach

    const attempts = await attemptsFor(invitation.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0].attemptedByUserId).toBeNull();
    expect(attempts[0].attemptedByEmail).toBe(operator.email);
    expect(attempts[0].attemptedByDisplayName).toBe(operator.displayName);
  });

  describe("retry/idempotency: the claim is the enforcement boundary", () => {
    it("a losing concurrent resend never calls send() and never writes an attempt row", async () => {
      const operator = await makeOperator();
      const invitation = await issueTracked();

      // Simulate "a resend is already in flight" by holding a live claim —
      // exactly what deliverBetaInvitationEmailWithClaim's own first step
      // would have done for a genuinely concurrent request.
      const inFlightClaim = await claimBetaInvitationResend(invitation.id);

      const send = async () =>
        ({ status: "sent", messageId: "should-never-be-called" }) satisfies EmailResult;

      await expect(
        deliverBetaInvitationEmailWithClaim(
          invitation,
          "https://example.test/redeem/tok",
          send,
          operator.id,
          "resend",
        ),
      ).rejects.toThrow(
        "A delivery attempt is already in progress for this invitation",
      );

      const attempts = await attemptsFor(invitation.id);
      expect(attempts).toHaveLength(0);

      // Release the in-flight claim, then prove a genuinely subsequent
      // resend succeeds normally and produces exactly the one real row.
      await releaseBetaInvitationResend(
        inFlightClaim.invitationId,
        inFlightClaim.claimId,
      );

      const status = await deliverBetaInvitationEmailWithClaim(
        invitation,
        "https://example.test/redeem/tok",
        async () => ({ status: "sent", messageId: "real-send" }),
        operator.id,
        "resend",
      );
      expect(status).toBe("sent");

      const finalAttempts = await attemptsFor(invitation.id);
      expect(finalAttempts).toHaveLength(1);
      expect(finalAttempts[0].providerMessageId).toBe("real-send");
    });
  });

  describe("migration constraints against real Postgres", () => {
    it("Restrict: deleting an invitation with delivery history fails until the attempts are removed first", async () => {
      const operator = await makeOperator();
      const invitation = await issueTracked();
      await deliverBetaInvitationEmail(
        invitation,
        "https://example.test/redeem/tok",
        async () => ({ status: "skipped" }),
        operator.id,
      );

      await expect(
        prisma.betaInvitation.delete({ where: { id: invitation.id } }),
      ).rejects.toThrow();

      // Now prove the *correct* order (attempts first) succeeds, matching
      // the plan's finding that no cleanup tool needs to change because
      // nothing hard-deletes BetaInvitation today — but the constraint
      // itself must behave exactly as documented if anything ever did.
      await prisma.betaInvitationDeliveryAttempt.deleteMany({
        where: { invitationId: invitation.id },
      });
      await expect(
        prisma.betaInvitation.delete({ where: { id: invitation.id } }),
      ).resolves.toBeDefined();

      // Already deleted directly above; don't let afterEach try again.
      createdInvitationIds.splice(
        createdInvitationIds.indexOf(invitation.id),
        1,
      );
    });

    it("CHECK: a FAILED row without a failure reason is rejected at the database level", async () => {
      const operator = await makeOperator();
      const invitation = await issueTracked();

      await expect(
        prisma.$executeRaw`
          INSERT INTO "BetaInvitationDeliveryAttempt"
            ("id", "invitationId", "trigger", "status", "attemptedByUserId", "attemptedByEmail", "requestId")
          VALUES
            (${`chk-${Date.now()}`}, ${invitation.id}, 'ISSUE', 'FAILED', ${operator.id}, ${operator.email}, 'req-check')
        `,
      ).rejects.toThrow();
    });

    it("CHECK: a SENT row carrying a failureReason is rejected at the database level", async () => {
      const operator = await makeOperator();
      const invitation = await issueTracked();

      await expect(
        prisma.$executeRaw`
          INSERT INTO "BetaInvitationDeliveryAttempt"
            ("id", "invitationId", "trigger", "status", "failureReason", "attemptedByUserId", "attemptedByEmail", "requestId")
          VALUES
            (${`chk-${Date.now()}`}, ${invitation.id}, 'ISSUE', 'SENT', 'should not be allowed', ${operator.id}, ${operator.email}, 'req-check')
        `,
      ).rejects.toThrow();
    });

    it("CHECK: a FAILED row carrying a providerMessageId is rejected at the database level", async () => {
      const operator = await makeOperator();
      const invitation = await issueTracked();

      await expect(
        prisma.$executeRaw`
          INSERT INTO "BetaInvitationDeliveryAttempt"
            ("id", "invitationId", "trigger", "status", "failureReason", "providerMessageId", "attemptedByUserId", "attemptedByEmail", "requestId")
          VALUES
            (${`chk-${Date.now()}`}, ${invitation.id}, 'ISSUE', 'FAILED', 'boom', 'unexpected-id', ${operator.id}, ${operator.email}, 'req-check')
        `,
      ).rejects.toThrow();
    });

    it("CHECK: an over-length failureReason is rejected at the database level", async () => {
      const operator = await makeOperator();
      const invitation = await issueTracked();
      const tooLong = "x".repeat(301);

      await expect(
        prisma.$executeRaw`
          INSERT INTO "BetaInvitationDeliveryAttempt"
            ("id", "invitationId", "trigger", "status", "failureReason", "attemptedByUserId", "attemptedByEmail", "requestId")
          VALUES
            (${`chk-${Date.now()}`}, ${invitation.id}, 'ISSUE', 'FAILED', ${tooLong}, ${operator.id}, ${operator.email}, 'req-check')
        `,
      ).rejects.toThrow();
    });

    it("a valid row at the boundary lengths (300/200 chars) is accepted", async () => {
      const operator = await makeOperator();
      const invitation = await issueTracked();
      const exactly300 = "x".repeat(300);
      const rowId = `chk-ok-${Date.now()}`;

      await prisma.$executeRaw`
        INSERT INTO "BetaInvitationDeliveryAttempt"
          ("id", "invitationId", "trigger", "status", "failureReason", "attemptedByUserId", "attemptedByEmail", "requestId")
        VALUES
          (${rowId}, ${invitation.id}, 'ISSUE', 'FAILED', ${exactly300}, ${operator.id}, ${operator.email}, 'req-check')
      `;

      const row = await prisma.betaInvitationDeliveryAttempt.findUnique({
        where: { id: rowId },
      });
      expect(row?.failureReason).toHaveLength(300);
    });
  });
});
