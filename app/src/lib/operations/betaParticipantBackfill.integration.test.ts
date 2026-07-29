import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import {
  runBetaParticipantValidationCheck,
} from "./betaParticipantValidation";
import {
  backfillEmailGroup,
  runBetaParticipantBackfill,
} from "./betaParticipantBackfillDb";

/**
 * Backfill + validation gate tests for #174 PR 1b (pre-contract schema only).
 *
 * Run locally with: INTEGRATION_DB=true npm run test:integration
 */
const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("beta participant backfill gate [integration]", () => {
  const createdUserIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];

  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = (await import("../prisma")) as unknown as {
      prisma: PrismaClient;
    });
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

  async function makeUser(label: string) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `${label}-${suffix}@example.test`,
        displayName: label,
        passwordHash: "placeholder-hash-not-a-real-password",
        sessionVersion: 0,
      },
    });
    createdUserIds.push(user.id);
    return user;
  }

  async function makeLegacyInvitation(
    email: string,
    overrides: {
      acceptedByUserId?: string | null;
      acceptedAt?: Date | null;
    } = {},
  ) {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const now = new Date();
    const id = `legacy-inv-${suffix}`;
    const token = `token-${suffix}`;
    const code = `C${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
    const expiresAt = new Date(now.getTime() + 86400000);
    const acceptedAt = overrides.acceptedAt ?? null;
    const acceptedByUserId = overrides.acceptedByUserId ?? null;

    await prisma.$executeRaw`
      INSERT INTO "BetaInvitation" (
        id, email, token, code, "expiresAt", "createdAt", "issuedAt", "updatedAt",
        "participantId", "acceptedAt", "acceptedByUserId"
      )
      VALUES (
        ${id}, ${email}, ${token}, ${code}, ${expiresAt}, ${now}, ${now}, ${now},
        NULL, ${acceptedAt}, ${acceptedByUserId}
      )
    `;
    createdInvitationIds.push(id);
    return { id, email };
  }

  async function trackParticipantsForEmail(email: string) {
    const rows = await prisma.betaInvitation.findMany({
      where: { email },
      select: { participantId: true },
    });
    for (const row of rows) {
      if (row.participantId) {
        createdParticipantIds.push(row.participantId);
      }
    }
  }

  async function assertEmailGroupPassesValidation(email: string) {
    const nullRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "BetaInvitation"
      WHERE email = ${email} AND "participantId" IS NULL
    `;
    expect(Number(nullRows[0]?.count ?? 0)).toBe(0);

    const multiUser = await prisma.$queryRaw<Array<{ participantId: string }>>`
      SELECT p.id AS "participantId"
      FROM "BetaParticipant" p
      JOIN "BetaInvitation" bi ON bi."participantId" = p.id
      WHERE bi.email = ${email}
        AND p."identityAmbiguous" = false
        AND bi."acceptedAt" IS NOT NULL
        AND bi."acceptedByUserId" IS NOT NULL
      GROUP BY p.id
      HAVING COUNT(DISTINCT bi."acceptedByUserId") > 1
    `;
    expect(multiUser).toHaveLength(0);

    const collisions = await prisma.$queryRaw<Array<{ userId: string }>>`
      SELECT p."userId"
      FROM "BetaParticipant" p
      JOIN "BetaInvitation" bi ON bi."participantId" = p.id
      WHERE bi.email = ${email}
        AND p."userId" IS NOT NULL
      GROUP BY p."userId"
      HAVING COUNT(DISTINCT p.id) > 1
    `;
    expect(collisions).toHaveLength(0);
  }

  it("backfills legacy NULL participantId rows and passes validation", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `backfill-clean-${suffix}@example.test`;
    const user = await makeUser("backfill-clean");

    await makeLegacyInvitation(email, {
      acceptedAt: new Date(),
      acceptedByUserId: user.id,
    });
    await makeLegacyInvitation(email);

    await runBetaParticipantBackfill(prisma, { dryRun: false });

    const remaining = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "BetaInvitation"
      WHERE email = ${email} AND "participantId" IS NULL
    `;
    expect(Number(remaining[0]?.count ?? 0)).toBe(0);

    await assertEmailGroupPassesValidation(email);

    await trackParticipantsForEmail(email);
  });

  it("splits two accepted users and marks ambiguous remainder", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `backfill-split-${suffix}@example.test`;
    const userA = await makeUser("split-a");
    const userB = await makeUser("split-b");

    await makeLegacyInvitation(email, {
      acceptedAt: new Date(),
      acceptedByUserId: userA.id,
    });
    await makeLegacyInvitation(email, {
      acceptedAt: new Date(),
      acceptedByUserId: userB.id,
    });
    const pending = await makeLegacyInvitation(email);

    const result = await backfillEmailGroup(prisma, email, { dryRun: false });
    expect(result.applied?.invitationsAssigned).toBe(3);

    const refreshed = await prisma.betaInvitation.findMany({
      where: { email },
      include: { participant: true },
    });

    const pendingRow = refreshed.find((row) => row.id === pending.id);
    expect(pendingRow?.participant?.identityAmbiguous).toBe(true);

    const acceptedParticipantIds = new Set(
      refreshed
        .filter((row) => row.acceptedAt)
        .map((row) => row.participantId),
    );
    expect(acceptedParticipantIds.size).toBe(2);

    await trackParticipantsForEmail(email);
  });

  it("is idempotent when run twice", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `backfill-idempotent-${suffix}@example.test`;
    await makeLegacyInvitation(email);
    await makeLegacyInvitation(email);

    await runBetaParticipantBackfill(prisma, { dryRun: false });
    const afterFirst = await prisma.betaInvitation.findMany({
      where: { email },
      select: { id: true, participantId: true },
      orderBy: { id: "asc" },
    });

    await runBetaParticipantBackfill(prisma, { dryRun: false });
    const afterSecond = await prisma.betaInvitation.findMany({
      where: { email },
      select: { id: true, participantId: true },
      orderBy: { id: "asc" },
    });

    expect(afterSecond).toEqual(afterFirst);
    await trackParticipantsForEmail(email);
  });

  it("does not split identity when issuance interleaves during backfill snapshot read", async () => {
    const { issueBetaInvitation } = await import("../betaInvitation");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `race-${suffix}@example.test`;

    const legacy = await makeLegacyInvitation(email);
    await prisma.betaInvitation.update({
      where: { id: legacy.id },
      data: { expiresAt: new Date(Date.now() - 86400000) },
    });

    let issuedDuringSnapshot = false;
    const result = await backfillEmailGroup(prisma, email, {
      dryRun: false,
      hooks: {
        afterSnapshotRead: async ({ attempt }) => {
          if (issuedDuringSnapshot) {
            return;
          }
          issuedDuringSnapshot = true;
          const issued = await issueBetaInvitation(email);
          createdInvitationIds.push(issued.invitation.id);
          if (issued.invitation.participantId) {
            createdParticipantIds.push(issued.invitation.participantId);
          }
          expect(attempt).toBe(0);
        },
      },
    });

    expect(issuedDuringSnapshot).toBe(true);
    expect(result.attemptsUsed).toBeGreaterThan(1);

    const rows = await prisma.betaInvitation.findMany({
      where: { email },
      select: { participantId: true },
    });
    const participantIds = new Set(
      rows.map((row) => row.participantId).filter(Boolean),
    );
    expect(participantIds.size).toBe(1);

    await trackParticipantsForEmail(email);
  });

  it("merges three existing participants onto the oldest survivor", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `merge-three-${suffix}@example.test`;
    const now = new Date();

    const oldest = await prisma.betaParticipant.create({
      data: { createdAt: new Date(now.getTime() - 3000) },
    });
    const middle = await prisma.betaParticipant.create({
      data: { createdAt: new Date(now.getTime() - 2000) },
    });
    const newest = await prisma.betaParticipant.create({
      data: { createdAt: new Date(now.getTime() - 1000) },
    });
    createdParticipantIds.push(oldest.id, middle.id, newest.id);

    const attach = async (participantId: string, label: string) => {
      const id = `merge-inv-${label}-${suffix}`;
      await prisma.betaInvitation.create({
        data: {
          id,
          email,
          token: `tok-${id}`,
          code: `M${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          expiresAt: new Date(now.getTime() + 86400000),
          participantId,
        },
      });
      createdInvitationIds.push(id);
    };

    await attach(newest.id, "newest");
    await attach(middle.id, "middle");
    await attach(oldest.id, "oldest");
    await makeLegacyInvitation(email);

    await backfillEmailGroup(prisma, email, { dryRun: false });

    const rows = await prisma.betaInvitation.findMany({
      where: { email },
      select: { participantId: true },
    });
    const participantIds = new Set(
      rows.map((row) => row.participantId).filter(Boolean),
    );
    expect(participantIds).toEqual(new Set([oldest.id]));

    const remaining = await prisma.betaParticipant.findMany({
      where: { id: { in: [oldest.id, middle.id, newest.id] } },
      select: { id: true },
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(oldest.id);
  });

  it("validation flags null participantId rows", async () => {
    await makeLegacyInvitation(`validate-null-${Date.now()}@example.test`);
    const result = await runBetaParticipantValidationCheck(
      prisma,
      "null_participant_id",
    );
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("validation flags unflagged multi-user participants", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const userA = await makeUser("val-a");
    const userB = await makeUser("val-b");
    const participant = await prisma.betaParticipant.create({ data: {} });
    createdParticipantIds.push(participant.id);

    const makeInv = async (userId: string) => {
      const id = `val-inv-${userId.slice(-6)}-${suffix}`;
      const now = new Date();
      await prisma.betaInvitation.create({
        data: {
          id,
          email: `multi-user-${suffix}@example.test`,
          token: `tok-${id}`,
          code: `M${suffix.slice(0, 5).toUpperCase()}${userId.slice(-1)}`,
          expiresAt: new Date(now.getTime() + 86400000),
          acceptedAt: now,
          acceptedByUserId: userId,
          participantId: participant.id,
        },
      });
      createdInvitationIds.push(id);
    };
    await makeInv(userA.id);
    await makeInv(userB.id);

    const result = await runBetaParticipantValidationCheck(
      prisma,
      "unflagged_multi_user",
    );
    expect(result.rows.some((row) => row.participantId === participant.id)).toBe(
      true,
    );
  });

  it("validation flags colliding userId claims", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await makeUser("collision");
    const participantAId = `collision-a-${suffix}`;
    const participantBId = `collision-b-${suffix}`;
    await prisma.$executeRaw`
      INSERT INTO "BetaParticipant" (id, "createdAt", "userId", "identityAmbiguous")
      VALUES (${participantAId}, NOW(), ${user.id}, false)
    `;
    await prisma.$executeRaw`
      INSERT INTO "BetaParticipant" (id, "createdAt", "userId", "identityAmbiguous")
      VALUES (${participantBId}, NOW(), ${user.id}, false)
    `;
    createdParticipantIds.push(participantAId, participantBId);

    const result = await runBetaParticipantValidationCheck(
      prisma,
      "colliding_user_id",
    );
    expect(result.rows.length).toBeGreaterThan(0);
  });

  it("validation flags orphaned participants", async () => {
    const orphanId = `orphan-${Date.now()}`;
    await prisma.betaParticipant.create({ data: { id: orphanId } });
    createdParticipantIds.push(orphanId);

    const result = await runBetaParticipantValidationCheck(
      prisma,
      "orphaned_participant",
    );
    expect(result.rows.some((row) => row.participantId === orphanId)).toBe(true);
  });

  it("validation passes cleanly after backfill on prepared legacy data", async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `validate-clean-${suffix}@example.test`;
    await makeLegacyInvitation(email);

    await backfillEmailGroup(prisma, email, { dryRun: false });
    await assertEmailGroupPassesValidation(email);

    await trackParticipantsForEmail(email);
  });
});
