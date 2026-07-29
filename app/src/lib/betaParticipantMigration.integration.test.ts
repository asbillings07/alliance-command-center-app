import { describe, it, expect, beforeAll } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Confirms Deployment A/B (#174 PR 1a/1c) schema objects exist with expected
 * nullability and constraints after CI applies the full migration stack.
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

  it("exposes BetaParticipant and BetaInvitation columns with post-contract shape", async () => {
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
      "issuedByUserId",
      "revokedByUserId",
      "reissuedFromInvitationId",
      "resendClaimedAt",
      "resendClaimId",
    ]);
    for (const column of columns) {
      if (nullableColumns.has(column.column_name)) {
        expect(column.is_nullable).toBe("YES");
      } else if (column.column_name === "participantId") {
        expect(column.is_nullable).toBe("NO");
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

    const userIdUniqueIndex = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'BetaParticipant'
        AND indexname = 'BetaParticipant_userId_key'
    `;
    expect(userIdUniqueIndex).toHaveLength(1);
  });

  it("has no legacy NULL participantId rows after contract migration", async () => {
    const legacyRows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count
      FROM "BetaInvitation"
      WHERE "participantId" IS NULL
    `;
    expect(Number(legacyRows[0]?.count ?? 0)).toBe(0);

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

  it("uses migration-run setupActivityAt baseline rather than backdating to createdAt", async () => {
    const createdAt = new Date("2019-06-01T00:00:00.000Z");
    const alliance = await prisma.alliance.create({
      data: {
        name: `Grace baseline ${Date.now()}`,
        server: "S1",
        createdAt,
      },
      select: { id: true, setupActivityAt: true, createdAt: true },
    });

    expect(alliance.setupActivityAt.getTime()).toBeGreaterThan(
      alliance.createdAt.getTime(),
    );

    await prisma.alliance.delete({ where: { id: alliance.id } });
  });

  it("reuses participant when re-issuing after an expired invitation", async () => {
    const { issueBetaInvitation } = await import("./betaInvitation");
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const email = `reuse-expired-${suffix}@example.test`;
    const first = await issueBetaInvitation(email);
    await prisma.betaInvitation.update({
      where: { id: first.invitation.id },
      data: { expiresAt: new Date(Date.now() - 86400000) },
    });

    const second = await issueBetaInvitation(email);
    expect(second.invitation.participantId).toBe(first.invitation.participantId);

    await prisma.betaInvitation.deleteMany({
      where: { email },
    });
    if (first.invitation.participantId) {
      await prisma.betaParticipant.delete({
        where: { id: first.invitation.participantId },
      });
    }
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
