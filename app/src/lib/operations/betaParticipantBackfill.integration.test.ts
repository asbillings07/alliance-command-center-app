import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { runAllBetaParticipantValidationChecks } from "./betaParticipantValidation";
import {
  backfillEmailGroup,
  runBetaParticipantBackfill,
} from "./betaParticipantBackfillDb";

/**
 * End-to-end gate tests for #174 PR 1b: backfill → validate → contract migration.
 *
 * Run locally with: INTEGRATION_DB=true npm run test:integration
 */
const runDb = process.env.INTEGRATION_DB === "true";

const CONTRACT_MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260728190000_beta_participant_contract/migration.sql",
  ),
  "utf8",
);

/** Pre-flight DO block only — safe to run without applying DDL constraints. */
const CONTRACT_PREFLIGHT_SQL = CONTRACT_MIGRATION_SQL.split(
  "-- CreateIndex",
)[0]!.trim();

async function isParticipantIdNullable(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ is_nullable: string }>>`
    SELECT is_nullable
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'BetaInvitation'
      AND column_name = 'participantId'
  `;
  return rows[0]?.is_nullable === "YES";
}

describe.skipIf(!runDb)("beta participant backfill and contract gate [integration]", () => {
  const createdUserIds: string[] = [];
  const createdParticipantIds: string[] = [];
  const createdInvitationIds: string[] = [];
  const createdAllianceIds: string[] = [];

  let prisma: PrismaClient;
  let preContractDb = false;

  beforeAll(async () => {
    ({ prisma } = (await import("../prisma")) as unknown as {
      prisma: PrismaClient;
    });
    preContractDb = await isParticipantIdNullable(prisma);
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
    if (createdAllianceIds.length > 0) {
      await prisma.alliance.deleteMany({
        where: { id: { in: createdAllianceIds } },
      });
      createdAllianceIds.length = 0;
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
    const code = `C${suffix.slice(0, 6).toUpperCase()}`;
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

  it("backfills legacy NULL participantId rows and passes validation", async (ctx) => {
    if (!preContractDb) {
      ctx.skip();
      return;
    }
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

    const results = await runAllBetaParticipantValidationChecks(prisma);
    expect(results.every((result) => result.rows.length === 0)).toBe(true);
  });

  it("splits two accepted users and marks ambiguous remainder", async (ctx) => {
    if (!preContractDb) {
      ctx.skip();
      return;
    }
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

    const acceptedUserIds = new Set(
      refreshed
        .filter((row) => row.acceptedAt)
        .map((row) => row.participantId),
    );
    expect(acceptedUserIds.size).toBe(2);

    for (const participant of refreshed.map((row) => row.participant).filter(Boolean)) {
      createdParticipantIds.push(participant!.id);
    }
  });

  it("is idempotent when run twice", async (ctx) => {
    if (!preContractDb) {
      ctx.skip();
      return;
    }
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

    for (const row of afterSecond) {
      if (row.participantId) {
        createdParticipantIds.push(row.participantId);
      }
    }
  });

  it("pre-flight guard passes after backfill on clean legacy data", async (ctx) => {
    if (!preContractDb) {
      ctx.skip();
      return;
    }
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `contract-clean-${suffix}@example.test`;
    await makeLegacyInvitation(email);

    await runBetaParticipantBackfill(prisma, { dryRun: false });
    const results = await runAllBetaParticipantValidationChecks(prisma);
    expect(results.every((result) => result.rows.length === 0)).toBe(true);

    await expect(
      prisma.$executeRawUnsafe(CONTRACT_PREFLIGHT_SQL),
    ).resolves.toBeDefined();

    const rows = await prisma.betaInvitation.findMany({
      where: { email },
      select: { participantId: true },
    });
    for (const row of rows) {
      createdParticipantIds.push(row.participantId!);
    }
  });

  it("contract migration pre-flight guard rejects remaining NULL participantId", async (ctx) => {
    if (!preContractDb) {
      ctx.skip();
      return;
    }
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await makeLegacyInvitation(`contract-block-${suffix}@example.test`);

    await expect(
      prisma.$executeRawUnsafe(CONTRACT_PREFLIGHT_SQL),
    ).rejects.toThrow(/participantId IS NULL rows remain/);
  });

  it("contract migration pre-flight guard rejects colliding userId claims", async (ctx) => {
    if (!preContractDb) {
      ctx.skip();
      return;
    }
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

    await expect(
      prisma.$executeRawUnsafe(CONTRACT_PREFLIGHT_SQL),
    ).rejects.toThrow(/colliding BetaParticipant.userId/);
  });

  it("validation passes on post-contract CI database", async () => {
    const results = await runAllBetaParticipantValidationChecks(prisma);
    expect(results.every((result) => result.rows.length === 0)).toBe(true);
  });
});
