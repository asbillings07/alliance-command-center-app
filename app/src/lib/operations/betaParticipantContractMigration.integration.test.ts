import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { runAllBetaParticipantValidationChecks } from "./betaParticipantValidation";
import { backfillEmailGroup } from "./betaParticipantBackfillDb";

/**
 * End-to-end contract migration test for #174 PR 1c.
 *
 * Seeds legacy NULL participantId rows, backfills, validates, then applies the
 * contract migration DDL and asserts constraints land correctly.
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

const REVERT_CONTRACT_SQL = `
ALTER TABLE "BetaInvitation" ALTER COLUMN "participantId" DROP NOT NULL;
DROP INDEX IF EXISTS "BetaParticipant_userId_key";
DROP INDEX IF EXISTS "BetaInvitation_reissuedFromInvitationId_key";
`;

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

async function contractIndexesExist(prisma: PrismaClient): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ indexname: string }>>`
    SELECT indexname
    FROM pg_indexes
    WHERE schemaname = 'public'
      AND indexname IN (
        'BetaParticipant_userId_key',
        'BetaInvitation_reissuedFromInvitationId_key'
      )
  `;
  return rows.length === 2;
}

(runDb ? describe.sequential : describe.skip)(
  "beta participant contract migration [integration]",
  () => {
    const createdUserIds: string[] = [];
    const createdParticipantIds: string[] = [];
    const createdInvitationIds: string[] = [];

    let prisma: PrismaClient;
    let revertedContractForTest = false;

    beforeAll(async () => {
      ({ prisma } = (await import("../prisma")) as unknown as {
        prisma: PrismaClient;
      });

      const nullable = await isParticipantIdNullable(prisma);
      if (!nullable) {
        await prisma.$executeRawUnsafe(REVERT_CONTRACT_SQL);
        revertedContractForTest = true;
      }
    });

    afterAll(async () => {
      if (createdInvitationIds.length > 0) {
        await prisma.betaInvitation.deleteMany({
          where: { id: { in: createdInvitationIds } },
        });
      }
      if (createdParticipantIds.length > 0) {
        await prisma.betaParticipant.deleteMany({
          where: { id: { in: createdParticipantIds } },
        });
      }
      if (createdUserIds.length > 0) {
        await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
      }

      if (revertedContractForTest) {
        await prisma.$executeRawUnsafe(CONTRACT_MIGRATION_SQL);
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
      const id = `contract-inv-${suffix}`;
      const token = `token-${suffix}`;
      const code = `K${suffix.slice(0, 6).toUpperCase()}`;
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

    it("backfills legacy data, validates clean, and applies contract constraints", async () => {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const email = `contract-e2e-${suffix}@example.test`;
      const user = await makeUser("contract-e2e");

      await makeLegacyInvitation(email, {
        acceptedAt: new Date(),
        acceptedByUserId: user.id,
      });
      await makeLegacyInvitation(email);

      await backfillEmailGroup(prisma, email, { dryRun: false });

      const remaining = await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint AS count
        FROM "BetaInvitation"
        WHERE email = ${email} AND "participantId" IS NULL
      `;
      expect(Number(remaining[0]?.count ?? 0)).toBe(0);

      const validation = await runAllBetaParticipantValidationChecks(prisma);
      expect(validation.every((result) => result.rows.length === 0)).toBe(true);

      expect(await isParticipantIdNullable(prisma)).toBe(true);
      expect(await contractIndexesExist(prisma)).toBe(false);

      await expect(
        prisma.$executeRawUnsafe(CONTRACT_MIGRATION_SQL),
      ).resolves.toBeDefined();

      expect(await isParticipantIdNullable(prisma)).toBe(false);
      expect(await contractIndexesExist(prisma)).toBe(true);

      const participant = await prisma.betaParticipant.create({
        data: { userId: user.id },
      });
      createdParticipantIds.push(participant.id);

      await expect(
        prisma.betaParticipant.create({
          data: { userId: user.id },
        }),
      ).rejects.toThrow();

      const rows = await prisma.betaInvitation.findMany({
        where: { email },
        select: { participantId: true },
      });
      for (const row of rows) {
        createdParticipantIds.push(row.participantId);
      }

      revertedContractForTest = false;
    });
  },
);
