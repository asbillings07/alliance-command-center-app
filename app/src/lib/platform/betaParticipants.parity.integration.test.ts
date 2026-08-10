import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getAllianceSetupStatus } from "../allianceSetup";
import { resolveTargetPeriod } from "../periods/resolveTargetPeriod";
import {
  deriveJourneyStage,
  deriveParticipantAttention,
  deriveLatestAttemptStatus,
  queryBetaParticipantDerivationForTest,
} from "./betaParticipants";

/**
 * Mandatory SQL/TS parity suite for the beta participant derivation CTE (#174 PR 2).
 *
 * Run locally with: INTEGRATION_DB=true npm run test:integration
 */
const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration("betaParticipants SQL/TS parity [integration]", () => {
  const createdUserIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];
  const createdAllianceIds: string[] = [];
  const createdMetricIds: string[] = [];
  const createdPeriodIds: string[] = [];
  const createdMemberIds: string[] = [];
  const createdMembershipIds: string[] = [];

  let prisma: PrismaClient;
  let issueBetaInvitation: (typeof import("../betaInvitation"))["issueBetaInvitation"];
  let acceptBetaInvitation: (typeof import("../betaInvitation"))["acceptBetaInvitation"];

  const now = new Date("2026-07-29T12:00:00Z");

  beforeAll(async () => {
    process.env.NEXTAUTH_URL ??= "http://localhost:3000";
    ({ prisma } = (await import("../prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ issueBetaInvitation, acceptBetaInvitation } = await import("../betaInvitation"));
  });

  afterEach(async () => {
    if (createdMemberIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMemberId: { in: createdMemberIds } },
      });
      await prisma.allianceMember.deleteMany({
        where: { id: { in: createdMemberIds } },
      });
      createdMemberIds.length = 0;
    }
    if (createdPeriodIds.length > 0) {
      await prisma.metricPeriodMetric.deleteMany({
        where: { periodId: { in: createdPeriodIds } },
      });
      await prisma.metricPeriod.deleteMany({
        where: { id: { in: createdPeriodIds } },
      });
      createdPeriodIds.length = 0;
    }
    if (createdMetricIds.length > 0) {
      await prisma.metric.deleteMany({ where: { id: { in: createdMetricIds } } });
      createdMetricIds.length = 0;
    }
    if (createdMembershipIds.length > 0) {
      await prisma.allianceMembership.deleteMany({
        where: { id: { in: createdMembershipIds } },
      });
      createdMembershipIds.length = 0;
    }
    if (createdInvitationIds.length > 0) {
      await prisma.betaInvitation.deleteMany({
        where: { id: { in: createdInvitationIds } },
      });
      createdInvitationIds.length = 0;
    }
    if (createdAllianceIds.length > 0) {
      await prisma.allianceMembership.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.alliance.deleteMany({
        where: { id: { in: createdAllianceIds } },
      });
      createdAllianceIds.length = 0;
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

  async function makeUser(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix}@example.test`,
        displayName: label,
        passwordHash: "hash",
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function makeAlliance(name: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: {
        name: `${name}-${suffix}`,
        server: "S1",
        setupActivityAt: new Date("2026-07-01T12:00:00Z"),
      },
    });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  async function trackInvitation(email: string) {
    const result = await issueBetaInvitation(email);
    createdInvitationIds.push(result.invitation.id);
    createdParticipantIds.push(result.invitation.participantId);
    return result.invitation;
  }

  async function getCteRow(participantId: string) {
    const rows = await queryBetaParticipantDerivationForTest(now);
    const row = rows.find((r) => r.participantId === participantId);
    if (!row) {
      throw new Error(`CTE row not found for participant ${participantId}`);
    }
    return row;
  }

  async function getLatestInvitation(participantId: string) {
    return prisma.betaInvitation.findFirst({
      where: { participantId },
      orderBy: [{ issuedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
  }

  it(
    "matches isComplete with getAllianceSetupStatus across required-task combinations",
    async () => {
    const combinations = [
      { period: false, metrics: false, members: false, data: false },
      { period: true, metrics: false, members: false, data: false },
      { period: true, metrics: true, members: false, data: false },
      { period: true, metrics: true, members: true, data: false },
      { period: true, metrics: true, members: true, data: true },
    ] as const;

    for (const combo of combinations) {
      const user = await makeUser(`parity-setup-${combo.period}-${combo.data}`);
      const invitation = await trackInvitation(user.email);
      await acceptBetaInvitation(invitation.id, user.id);

      const alliance = await makeAlliance(`Parity-${Date.now()}`);
      await prisma.allianceMembership.create({
        data: { allianceId: alliance.id, userId: user.id, role: "OWNER" },
      });
      await prisma.betaInvitation.update({
        where: { id: invitation.id },
        data: { allianceId: alliance.id },
      });

      let metricId: string | null = null;
      let periodId: string | null = null;
      let memberId: string | null = null;

      if (combo.period) {
        const period = await prisma.metricPeriod.create({
          data: {
            allianceId: alliance.id,
            name: "P1",
            active: true,
            startsAt: new Date("2026-07-01T00:00:00Z"),
          },
        });
        createdPeriodIds.push(period.id);
        periodId = period.id;
      }

      if (combo.metrics && periodId) {
        const metric = await prisma.metric.create({
          data: { allianceId: alliance.id, name: "VS", type: "NUMERIC", active: true },
        });
        createdMetricIds.push(metric.id);
        metricId = metric.id;
        await prisma.metricPeriodMetric.create({
          data: {
            periodId,
            metricId: metric.id,
            weight: 1,
            required: true,
            active: true,
          },
        });
      }

      if (combo.members) {
        const member = await prisma.allianceMember.create({
          data: { allianceId: alliance.id, playerName: `Player-${periodId}` },
        });
        createdMemberIds.push(member.id);
        memberId = member.id;
      }

      if (combo.data && periodId && metricId && memberId) {
        await prisma.memberMetricEntry.create({
          data: {
            allianceMemberId: memberId,
            periodId,
            metricId,
            value: 100,
          },
        });
      }

      const setupStatus = await getAllianceSetupStatus(alliance.id);
      const cteRow = await getCteRow(invitation.participantId);
      expect(cteRow.isComplete).toBe(setupStatus.isComplete);
    }
  },
    30_000,
  );

  it("uses the same target period as resolveTargetPeriod for metrics/data checks", async () => {
    const user = await makeUser("parity-period");
    const invitation = await trackInvitation(user.email);
    await acceptBetaInvitation(invitation.id, user.id);

    const alliance = await makeAlliance("Period Alliance");
    const membership = await prisma.allianceMembership.create({
      data: { allianceId: alliance.id, userId: user.id, role: "OWNER" },
    });
    createdMembershipIds.push(membership.id);
    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { allianceId: alliance.id },
    });

    const oldPeriod = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "Old",
        active: false,
        startsAt: new Date("2026-01-01T00:00:00Z"),
      },
    });
    createdPeriodIds.push(oldPeriod.id);

    const oldMetric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "OldMetric", type: "NUMERIC", active: true },
    });
    createdMetricIds.push(oldMetric.id);
    await prisma.metricPeriodMetric.create({
      data: {
        periodId: oldPeriod.id,
        metricId: oldMetric.id,
        weight: 1,
        required: true,
        active: true,
      },
    });

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: "OldPlayer" },
    });
    createdMemberIds.push(member.id);
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: member.id,
        periodId: oldPeriod.id,
        metricId: oldMetric.id,
        value: 50,
      },
    });

    const newPeriod = await prisma.metricPeriod.create({
      data: {
        allianceId: alliance.id,
        name: "New Active",
        active: true,
        startsAt: new Date("2026-07-01T00:00:00Z"),
      },
    });
    createdPeriodIds.push(newPeriod.id);

    const targetPeriod = await resolveTargetPeriod(alliance.id);
    expect(targetPeriod?.id).toBe(newPeriod.id);

    const cteRow = await getCteRow(invitation.participantId);
    expect(cteRow.isComplete).toBe(false);
    expect(cteRow.hasTargetPeriodData).toBe(false);
    expect(cteRow.journeyStage).toBe("roster_imported");
  });

  it("flags alliance ambiguity and caps journey stage at accepted", async () => {
    const user = await makeUser("parity-ambiguous");
    const invitation = await trackInvitation(user.email);
    await acceptBetaInvitation(invitation.id, user.id);

    const a1 = await makeAlliance("Amb A");
    const a2 = await makeAlliance("Amb B");
    const memberships = await prisma.allianceMembership.createMany({
      data: [
        { allianceId: a1.id, userId: user.id, role: "OWNER" },
        { allianceId: a2.id, userId: user.id, role: "OWNER" },
      ],
    });
    void memberships;

    const cteRow = await getCteRow(invitation.participantId);
    expect(cteRow.allianceAmbiguous).toBe(true);
    expect(cteRow.allianceId).toBeNull();
    expect(cteRow.journeyStage).toBe("accepted");

    const latest = await getLatestInvitation(invitation.participantId);
    const ts = deriveJourneyStage({
      allianceAmbiguous: true,
      hasAccepted: true,
      allianceId: null,
      activeMemberCount: 0,
      hasTargetPeriodData: false,
      isComplete: false,
    });
    expect(cteRow.journeyStage).toBe(ts);
    expect(
      deriveLatestAttemptStatus(
        {
          acceptedAt: latest!.acceptedAt,
          revokedAt: latest!.revokedAt,
          expiresAt: latest!.expiresAt,
        },
        now,
      ),
    ).toBe("accepted");
  });

  it("matches journeyStage and attentionReason with pure TS derivations", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `parity-attn-${suffix}@example.test`;
    const invitation = await trackInvitation(email);
    const staleIssuedAt = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { issuedAt: staleIssuedAt },
    });

    const cteRow = await getCteRow(invitation.participantId);
    const latest = await getLatestInvitation(invitation.participantId);
    const latestStatus = deriveLatestAttemptStatus(
      {
        acceptedAt: latest!.acceptedAt,
        revokedAt: latest!.revokedAt,
        expiresAt: latest!.expiresAt,
      },
      now,
    );

    const journey = deriveJourneyStage({
      allianceAmbiguous: cteRow.allianceAmbiguous,
      hasAccepted: cteRow.hasAccepted,
      allianceId: cteRow.allianceId,
      activeMemberCount: cteRow.activeMemberCount,
      hasTargetPeriodData: cteRow.hasTargetPeriodData,
      isComplete: cteRow.isComplete,
    });

    const firstAccepted = await prisma.betaInvitation.findFirst({
      where: { participantId: invitation.participantId, acceptedAt: { not: null } },
      orderBy: { acceptedAt: "asc" },
    });

    const attention = deriveParticipantAttention({
      now,
      latestStatus,
      latestIssuedAt: latest!.issuedAt,
      latestExpiresAt: latest!.expiresAt,
      hasAccepted: cteRow.hasAccepted,
      firstAcceptedAt: firstAccepted?.acceptedAt ?? null,
      allianceId: cteRow.allianceId,
      isComplete: cteRow.isComplete,
      lastSetupActivityAt: null,
    });

    expect(cteRow.journeyStage).toBe(journey);
    expect(cteRow.attentionReason).toBe(attention.reason);
    expect(cteRow.attentionSince?.toISOString()).toBe(
      attention.since?.toISOString() ?? undefined,
    );
  });

  // #287 Slice 3 follow-up: has_target_period_data/is_complete
  // (betaParticipants.ts) now require mme.status = 'ACTIVE', the same
  // bare predicate as platform/setup.ts's, platform/alliances.ts's, and
  // betaDashboard.ts's "has data" checks (not allianceSetup.ts's full
  // memberPeriodMetricValues slot-winner semantics - see the module-doc
  // comment beside the SQL). This closes the latent divergence the
  // previous version of this test documented: getAllianceSetupStatus's
  // isComplete and this CTE's isComplete stay in parity for a voided-only
  // target period, same as every other scenario in this file.
  async function makeVoidedOnlyAllianceSetup(label: string) {
    const user = await makeUser(label);
    const invitation = await trackInvitation(user.email);
    await acceptBetaInvitation(invitation.id, user.id);

    const alliance = await makeAlliance(label);
    const membership = await prisma.allianceMembership.create({
      data: { allianceId: alliance.id, userId: user.id, role: "OWNER" },
    });
    createdMembershipIds.push(membership.id);
    await prisma.betaInvitation.update({
      where: { id: invitation.id },
      data: { allianceId: alliance.id },
    });

    const period = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "P1", active: true, startsAt: new Date("2026-07-01T00:00:00Z") },
    });
    createdPeriodIds.push(period.id);

    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "VS", type: "NUMERIC", active: true },
    });
    createdMetricIds.push(metric.id);
    await prisma.metricPeriodMetric.create({
      data: { periodId: period.id, metricId: metric.id, weight: 1, required: true, active: true },
    });

    const member = await prisma.allianceMember.create({
      data: { allianceId: alliance.id, playerName: `${label}Player` },
    });
    createdMemberIds.push(member.id);

    return { alliance, invitation, period, metric, member };
  }

  it("EXPECTED_BREAKING vs. the pre-fix EXISTS: a voided-only target-period entry does not count toward is_complete, and matches getAllianceSetupStatus's isComplete", async () => {
    const { alliance, invitation, period, metric, member } =
      await makeVoidedOnlyAllianceSetup("parity-voided-fixed");

    // The member's ONLY entry for the target period is a void - no write
    // path can create this today (the void mutation is a later #287
    // slice), but nothing in the schema itself prevents constructing one
    // directly for this test.
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: null, status: "VOIDED" },
    });

    const setupStatus = await getAllianceSetupStatus(alliance.id);
    const cteRow = await getCteRow(invitation.participantId);

    // Old behavior (removed): a bare EXISTS over any MemberMetricEntry
    // row would have counted this VOIDED row, incorrectly reporting the
    // alliance as fully set up (is_complete: true).
    expect(cteRow.isComplete).toBe(false);
    expect(cteRow.hasTargetPeriodData).toBe(false);
    // Parity restored: both independently-computed values agree again.
    expect(cteRow.isComplete).toBe(setupStatus.isComplete);
  });

  it("marks is_complete/hasTargetPeriodData true, in parity with getAllianceSetupStatus, once a real ACTIVE entry exists", async () => {
    const { alliance, invitation, period, metric, member } =
      await makeVoidedOnlyAllianceSetup("parity-active-fixed");

    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 100 },
    });

    const setupStatus = await getAllianceSetupStatus(alliance.id);
    const cteRow = await getCteRow(invitation.participantId);

    expect(cteRow.isComplete).toBe(true);
    expect(cteRow.hasTargetPeriodData).toBe(true);
    expect(cteRow.isComplete).toBe(setupStatus.isComplete);
  });

  it("KNOWN GAP (doubly inert - needs a VOIDED row AND a same-slot ACTIVE predecessor, neither writable today): an ACTIVE entry later voided for the same slot still diverges from getAllianceSetupStatus", async () => {
    const { alliance, invitation, period, metric, member } =
      await makeVoidedOnlyAllianceSetup("parity-active-then-voided-gap");

    // Same (metric, member, observedOn) slot: an ACTIVE row, then a later
    // VOIDED correction. getAllianceSetupStatus's memberPeriodMetricValues
    // re-derives the CURRENT winner per slot (ADR-018 §1) and correctly
    // returns to "no data." This CTE's bare EXISTS only asks "did an
    // ACTIVE row ever exist here" and does not re-check the later void -
    // this is the one gap the module-doc comment beside the SQL calls out
    // as intentionally not closed by this follow-up.
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 50, recordedAt: new Date("2026-07-01T10:00:00Z") },
    });
    await prisma.memberMetricEntry.create({
      data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: null, status: "VOIDED", recordedAt: new Date("2026-07-02T10:00:00Z") },
    });

    const setupStatus = await getAllianceSetupStatus(alliance.id);
    const cteRow = await getCteRow(invitation.participantId);

    expect(setupStatus.isComplete).toBe(false);
    expect(cteRow.isComplete).toBe(true);
    expect(cteRow.isComplete).not.toBe(setupStatus.isComplete);
  });
});
