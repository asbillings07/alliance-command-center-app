import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { createIsolatedIntegrationDatabase } from "./testing/isolatedIntegrationDatabase";

/**
 * Validates the repository-appropriate rollback strategy for #175's
 * migration (docs/operations/rollback.md, "Option 1: Compensation
 * Migration"): because this migration is purely additive — it creates one
 * new table and two new enums, and never ALTERs or DROPs anything
 * pre-existing — rolling it back in production is just a forward-only
 * compensation migration that drops what it added.
 *
 * This test proves that compensation migration is safe (zero data loss to
 * any pre-existing table) and that the original migration re-applies
 * afterward with every constraint intact, matching the pattern established
 * by betaParticipantContractMigration.integration.test.ts. It runs against
 * a disposable isolated database (see createIsolatedIntegrationDatabase) so
 * this DDL churn can never affect the shared integration suite.
 *
 * Run locally with: INTEGRATION_DB=true npm run test:integration
 */
const runDb = process.env.INTEGRATION_DB === "true";

const FORWARD_MIGRATION_SQL = readFileSync(
  join(
    process.cwd(),
    "prisma/migrations/20260730164500_beta_invitation_delivery_attempts/migration.sql",
  ),
  "utf8",
);

// The compensation migration docs/operations/rollback.md describes for a
// purely additive migration: undo exactly what the forward migration added,
// nothing else.
const COMPENSATION_MIGRATION_SQL = `
DROP TABLE "BetaInvitationDeliveryAttempt";
DROP TYPE "BetaInvitationDeliveryTrigger";
DROP TYPE "BetaInvitationDeliveryStatus";
`;

async function tableExists(prisma: PrismaClient, tableName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = ${tableName}
    ) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

async function enumExists(prisma: PrismaClient, typeName: string): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
    SELECT EXISTS (SELECT 1 FROM pg_type WHERE typname = ${typeName}) AS "exists"
  `;
  return rows[0]?.exists ?? false;
}

(runDb ? describe.sequential : describe.skip)(
  "beta invitation delivery attempt migration rollback [integration]",
  () => {
    let prisma: PrismaClient;
    let disposeIsolatedDatabase: (() => Promise<void>) | null = null;

    beforeAll(async () => {
      const isolated = await createIsolatedIntegrationDatabase("delivery-rollback");
      prisma = isolated.prisma;
      disposeIsolatedDatabase = isolated.dispose;
    });

    afterAll(async () => {
      if (disposeIsolatedDatabase) {
        await disposeIsolatedDatabase();
        disposeIsolatedDatabase = null;
      }
    });

    async function makeUser(label: string) {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return prisma.user.create({
        data: {
          email: `${label}-${suffix}@example.test`,
          displayName: label,
          passwordHash: "placeholder-hash-not-a-real-password",
          sessionVersion: 0,
        },
      });
    }

    async function makeTrackedInvitation(label: string) {
      const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const participant = await prisma.betaParticipant.create({ data: {} });
      return prisma.betaInvitation.create({
        data: {
          email: `${label}-${suffix}@example.test`,
          token: `token-${suffix}`,
          code: `K${Math.random().toString(36).slice(2, 10).toUpperCase()}`,
          expiresAt: new Date(Date.now() + 86400000),
          participantId: participant.id,
        },
      });
    }

    it("the compensation migration removes exactly what #175 added, with zero data loss to any pre-existing table", async () => {
      expect(await tableExists(prisma, "BetaInvitationDeliveryAttempt")).toBe(true);
      expect(await enumExists(prisma, "BetaInvitationDeliveryTrigger")).toBe(true);
      expect(await enumExists(prisma, "BetaInvitationDeliveryStatus")).toBe(true);

      // Data that predates (and is unrelated to) this migration must survive
      // the compensation migration untouched.
      const operator = await makeUser("rollback-survivor");
      const invitation = await makeTrackedInvitation("rollback-survivor");
      await prisma.betaInvitationDeliveryAttempt.create({
        data: {
          invitationId: invitation.id,
          trigger: "ISSUE",
          status: "SENT",
          providerMessageId: "pre-rollback-msg",
          attemptedByUserId: operator.id,
          attemptedByEmail: operator.email,
          attemptedByDisplayName: operator.displayName,
          requestId: "req-pre-rollback",
        },
      });

      await prisma.$executeRawUnsafe(COMPENSATION_MIGRATION_SQL);

      expect(await tableExists(prisma, "BetaInvitationDeliveryAttempt")).toBe(false);
      expect(await enumExists(prisma, "BetaInvitationDeliveryTrigger")).toBe(false);
      expect(await enumExists(prisma, "BetaInvitationDeliveryStatus")).toBe(false);

      // Nothing pre-existing was touched: the invitation and user rows are
      // completely unaffected by dropping the table/enums #175 introduced.
      const survivedInvitation = await prisma.betaInvitation.findUnique({
        where: { id: invitation.id },
      });
      expect(survivedInvitation).not.toBeNull();
      const survivedUser = await prisma.user.findUnique({ where: { id: operator.id } });
      expect(survivedUser).not.toBeNull();
    });

    it("the forward migration re-applies cleanly after the compensation migration, with every constraint intact", async () => {
      // Picks up immediately after the previous test's compensation
      // migration left the isolated database rolled back — proving the
      // forward migration is itself idempotent/safe to re-run, not just
      // safe to apply once against a pristine database.
      await prisma.$executeRawUnsafe(FORWARD_MIGRATION_SQL);

      expect(await tableExists(prisma, "BetaInvitationDeliveryAttempt")).toBe(true);
      expect(await enumExists(prisma, "BetaInvitationDeliveryTrigger")).toBe(true);
      expect(await enumExists(prisma, "BetaInvitationDeliveryStatus")).toBe(true);

      const operator = await makeUser("rollback-recreated");
      const invitation = await makeTrackedInvitation("rollback-recreated");

      // A normal row still inserts correctly...
      await expect(
        prisma.betaInvitationDeliveryAttempt.create({
          data: {
            invitationId: invitation.id,
            trigger: "ISSUE",
            status: "SENT",
            providerMessageId: "post-recreate-msg",
            attemptedByUserId: operator.id,
            attemptedByEmail: operator.email,
            attemptedByDisplayName: operator.displayName,
            requestId: "req-post-recreate",
          },
        }),
      ).resolves.toBeDefined();

      // ...and the CHECK constraints are truly restored, not just the table
      // shell: a FAILED row with no reason must still be rejected.
      await expect(
        prisma.$executeRaw`
          INSERT INTO "BetaInvitationDeliveryAttempt"
            ("id", "invitationId", "trigger", "status", "attemptedByUserId", "attemptedByEmail", "requestId")
          VALUES
            (${`chk-${Date.now()}`}, ${invitation.id}, 'ISSUE', 'FAILED', ${operator.id}, ${operator.email}, 'req-check')
        `,
      ).rejects.toThrow();

      // ...and the Restrict FK is truly restored too.
      await expect(
        prisma.betaInvitation.delete({ where: { id: invitation.id } }),
      ).rejects.toThrow();
    });
  },
);
