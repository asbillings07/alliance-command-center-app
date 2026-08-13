import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { getRosterHealthSummary } from "./getRosterHealthSummary";

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("getRosterHealthSummary [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as { prisma: PrismaClient });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberImportRollback.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.memberImportChange.deleteMany({
        where: { memberImport: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.memberImport.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeAlliance() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Roster Health Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  async function makeMember(allianceId: string, playerName: string, archived = false) {
    return prisma.allianceMember.create({
      data: { allianceId, playerName, archivedAt: archived ? new Date("2026-01-01") : null },
    });
  }

  async function makeImport(
    allianceId: string,
    overrides: { createdCount?: number; restoredCount?: number; createdAt?: Date } = {},
  ) {
    return prisma.memberImport.create({
      data: {
        allianceId,
        actorEmailSnapshot: "actor@example.test",
        fileName: "roster.xlsx",
        sourceSheetName: "Sheet1",
        createdCount: overrides.createdCount ?? 0,
        restoredCount: overrides.restoredCount ?? 0,
        skippedExistingCount: 0,
        skippedDuplicateCount: 0,
        skippedEmptyNameCount: 0,
        skippedUnselectedCount: 0,
        ...(overrides.createdAt ? { createdAt: overrides.createdAt } : {}),
      },
    });
  }

  it("throws when allianceId is missing", async () => {
    await expect(getRosterHealthSummary("")).rejects.toThrow(/allianceId is required/);
  });

  it("counts active and archived members separately, scoped to the alliance", async () => {
    const alliance = await makeAlliance();
    await makeMember(alliance.id, "Active One");
    await makeMember(alliance.id, "Active Two");
    await makeMember(alliance.id, "Archived One", true);

    const summary = await getRosterHealthSummary(alliance.id);

    expect(summary.activeCount).toBe(2);
    expect(summary.archivedCount).toBe(1);
    expect(summary.latestImport).toBeNull();
  });

  it("reports the most recent import by createdAt, not by insertion order", async () => {
    const alliance = await makeAlliance();
    await makeImport(alliance.id, { createdCount: 3, createdAt: new Date("2026-01-01T00:00:00Z") });
    const latest = await makeImport(alliance.id, {
      createdCount: 5,
      restoredCount: 2,
      createdAt: new Date("2026-02-01T00:00:00Z"),
    });

    const summary = await getRosterHealthSummary(alliance.id);

    expect(summary.latestImport).toEqual({
      id: latest.id,
      createdAt: latest.createdAt,
      createdCount: 5,
      restoredCount: 2,
      rolledBack: false,
    });
  });

  it("marks the latest import as rolled back exactly when a MemberImportRollback exists for it", async () => {
    const alliance = await makeAlliance();
    const memberImport = await makeImport(alliance.id, { createdCount: 1 });
    await prisma.memberImportRollback.create({
      data: {
        memberImportId: memberImport.id,
        allianceId: alliance.id,
        actorEmailSnapshot: "actor@example.test",
        outcome: "ROLLED_BACK_WITH_RETAINED_MEMBERS",
        deletedCount: 1,
        revertedCount: 0,
        retainedActiveCount: 0,
        archivedPreservingHistoryCount: 0,
        retainedArchivedCount: 0,
        skippedConflictCount: 0,
      },
    });

    const summary = await getRosterHealthSummary(alliance.id);

    expect(summary.latestImport?.rolledBack).toBe(true);
  });

  it("never reflects another alliance's members or imports", async () => {
    const allianceA = await makeAlliance();
    const allianceB = await makeAlliance();
    await makeMember(allianceA.id, "A Member");
    await makeMember(allianceB.id, "B Member One");
    await makeMember(allianceB.id, "B Member Two", true);
    await makeImport(allianceB.id, { createdCount: 9 });

    const summaryA = await getRosterHealthSummary(allianceA.id);

    expect(summaryA.activeCount).toBe(1);
    expect(summaryA.archivedCount).toBe(0);
    expect(summaryA.latestImport).toBeNull();
  });
});
