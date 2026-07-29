import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { createIsolatedIntegrationDatabase } from "../testing/isolatedIntegrationDatabase";
import { runAllBetaParticipantValidationChecks } from "./betaParticipantValidation";
import { backfillEmailGroup } from "./betaParticipantBackfillDb";

/**
 * End-to-end contract migration test for #174 PR 1c.
 *
 * Runs in a disposable isolated database so reverting pre-contract DDL and
 * applying the contract migration cannot poison the shared integration suite DB.
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
    let prisma: PrismaClient;
    let disposeIsolatedDatabase: (() => Promise<void>) | null = null;

    beforeAll(async () => {
      const isolated = await createIsolatedIntegrationDatabase("contract");
      prisma = isolated.prisma;
      disposeIsolatedDatabase = isolated.dispose;

      await prisma.$executeRawUnsafe(REVERT_CONTRACT_SQL);
    });

    afterAll(async () => {
      if (disposeIsolatedDatabase) {
        await disposeIsolatedDatabase();
        disposeIsolatedDatabase = null;
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
      const code = `K${Math.random().toString(36).slice(2, 10).toUpperCase()}`;
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

      const duplicateUser = await makeUser("contract-dup");
      const participant = await prisma.betaParticipant.create({
        data: { userId: duplicateUser.id },
      });

      await expect(
        prisma.betaParticipant.create({
          data: { userId: participant.userId! },
        }),
      ).rejects.toThrow();

      const backfilled = await prisma.betaInvitation.findFirst({
        where: { email, acceptedByUserId: user.id },
        include: { participant: true },
      });
      expect(backfilled?.participant?.userId).toBe(user.id);
    });
  },
);
