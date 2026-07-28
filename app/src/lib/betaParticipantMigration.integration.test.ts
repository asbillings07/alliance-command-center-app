import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Confirms Deployment A (#174 PR 1a) schema objects exist with expected
 * nullability and that legacy rows remain valid after migration.
 *
 * Run locally with: INTEGRATION_DB=true npm run test:integration
 */
const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("beta participant migration [integration]", () => {
  let prisma: PrismaClient;

  beforeAll(async () => {
    ({ prisma } = (await import("./prisma")) as unknown as {
      prisma: PrismaClient;
    });
  });

  it("exposes BetaParticipant and nullable BetaInvitation.participantId", async () => {
    const columns = await prisma.$queryRaw<
      Array<{ column_name: string; is_nullable: string }>
    >`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'BetaInvitation'
        AND column_name IN (
          'participantId',
          'issuedByUserId',
          'revokedByUserId',
          'reissuedFromInvitationId',
          'resendClaimedAt',
          'resendClaimId',
          'updatedAt'
        )
      ORDER BY column_name
    `;

    expect(columns).toHaveLength(7);
    const nullableColumns = new Set([
      "participantId",
      "issuedByUserId",
      "revokedByUserId",
      "reissuedFromInvitationId",
      "resendClaimedAt",
      "resendClaimId",
    ]);
    for (const column of columns) {
      if (nullableColumns.has(column.column_name)) {
        expect(column.is_nullable).toBe("YES");
      } else if (column.column_name === "updatedAt") {
        expect(column.is_nullable).toBe("NO");
      }
    }

    const allianceColumn = await prisma.$queryRaw<
      Array<{ column_name: string; is_nullable: string }>
    >`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'Alliance'
        AND column_name = 'setupActivityAt'
    `;
    expect(allianceColumn).toHaveLength(1);
    expect(allianceColumn[0].is_nullable).toBe("NO");

    const participantUserId = await prisma.$queryRaw<
      Array<{ column_name: string; is_nullable: string }>
    >`
      SELECT column_name, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'BetaParticipant'
        AND column_name = 'userId'
    `;
    expect(participantUserId).toHaveLength(1);
    expect(participantUserId[0].is_nullable).toBe("YES");
  });

  it("leaves existing BetaInvitation and Alliance rows readable with null participantId", async () => {
    const legacyInvitation = await prisma.betaInvitation.findFirst({
      where: { participantId: null },
      select: { id: true, participantId: true, updatedAt: true },
    });

    if (legacyInvitation) {
      expect(legacyInvitation.participantId).toBeNull();
      expect(legacyInvitation.updatedAt).toBeInstanceOf(Date);
    }

    let alliance = await prisma.alliance.findFirst({
      select: { id: true, setupActivityAt: true, createdAt: true },
    });

    if (!alliance) {
      alliance = await prisma.alliance.create({
        data: {
          name: `Migration smoke ${Date.now()}`,
          server: "S1",
        },
        select: { id: true, setupActivityAt: true, createdAt: true },
      });
      await prisma.alliance.delete({ where: { id: alliance.id } });
    }

    expect(alliance.setupActivityAt).toBeInstanceOf(Date);
  });

  it("dual-writes participantId for newly issued invitations", async () => {
    const { issueBetaInvitation } = await import("./betaInvitation");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const { invitation } = await issueBetaInvitation(
      `migration-dual-write-${suffix}@example.test`,
    );

    expect(invitation.participantId).toBeTruthy();

    const participant = await prisma.betaParticipant.findUnique({
      where: { id: invitation.participantId! },
    });
    expect(participant).not.toBeNull();
    expect(participant!.userId).toBeNull();

    await prisma.betaInvitation.delete({ where: { id: invitation.id } });
    await prisma.betaParticipant.delete({
      where: { id: invitation.participantId! },
    });
  });
});
