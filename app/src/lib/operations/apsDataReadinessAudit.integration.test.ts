import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { runInReadOnlyAuditTransaction } from "./apsAuditTransaction";
import { runApsDataReadinessAudit } from "./apsDataReadinessAudit";
import { AllianceAllowlistError } from "./apsAuditAllowlist";
import {
  createAllianceWithChangedMetricBetweenPeriods,
  createAllianceWithMissingValues,
  createAllianceWithNegativeValues,
  createAllianceWithSparsePeriod,
} from "./apsAuditFixtures";

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("APS data-readiness audit [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as { prisma: PrismaClient });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({ where: { allianceMember: { allianceId: { in: createdAllianceIds } } } });
      await prisma.metricPeriodMetric.deleteMany({ where: { period: { allianceId: { in: createdAllianceIds } } } });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.allianceMember.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  // -------------------------------------------------------------------------
  // Read-only enforcement -- the actual safety boundary, proven against a
  // real PostgreSQL instance rather than assumed from a Prisma type.
  // -------------------------------------------------------------------------

  it("rejects a representative write attempted inside the read-only transaction, and the write does not persist", async () => {
    const attemptedName = `APS Audit Should Not Exist ${Date.now()}`;

    await expect(
      runInReadOnlyAuditTransaction(prisma, async (tx) => {
        await tx.alliance.create({ data: { name: attemptedName, server: "0000" } });
        return null;
      }),
    ).rejects.toThrow(/read-only/i);

    const survived = await prisma.alliance.findFirst({ where: { name: attemptedName } });
    expect(survived).toBeNull();
  });

  it("enforces the statement timeout, not just an unbounded read-only guarantee", async () => {
    await expect(
      runInReadOnlyAuditTransaction(
        prisma,
        async (tx) => {
          await tx.$queryRawUnsafe("SELECT pg_sleep(2)");
          return null;
        },
        { statementTimeoutMs: 200 },
      ),
    ).rejects.toThrow(/timeout/i);
  });

  it("commits nothing even on a fully successful, non-throwing run", async () => {
    const before = await prisma.alliance.count();
    const fixture = await createAllianceWithMissingValues(prisma);
    createdAllianceIds.push(fixture.allianceId);
    const afterFixture = await prisma.alliance.count();
    expect(afterFixture).toBe(before + 1);

    await runInReadOnlyAuditTransaction(prisma, (tx) => runApsDataReadinessAudit(tx, [fixture.allianceId]));

    // The audit itself only reads; the count should be unchanged from
    // immediately after fixture setup (i.e., the audit added/removed nothing).
    expect(await prisma.alliance.count()).toBe(afterFixture);
  });

  // -------------------------------------------------------------------------
  // Allowlist enforcement against a real Alliance table.
  // -------------------------------------------------------------------------

  it("aborts on an alliance id that does not resolve to any real alliance", async () => {
    await expect(
      runInReadOnlyAuditTransaction(prisma, (tx) => runApsDataReadinessAudit(tx, ["not-a-real-alliance-id"])),
    ).rejects.toThrow(AllianceAllowlistError);
  });

  it("never includes an alliance outside the allowlist, even when it exists in the same database", async () => {
    const inBounds = await createAllianceWithMissingValues(prisma);
    const outOfBounds = await createAllianceWithMissingValues(prisma);
    createdAllianceIds.push(inBounds.allianceId, outOfBounds.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [inBounds.allianceId]),
    );

    expect(report.allianceCount).toBe(1);
    expect(JSON.stringify(report)).not.toContain(outOfBounds.allianceId);
  });

  // -------------------------------------------------------------------------
  // End-to-end correctness of the real Prisma queries (not mocked) against
  // each synthetic edge-case fixture.
  // -------------------------------------------------------------------------

  it("reports missing values for members with no recorded entry", async () => {
    const fixture = await createAllianceWithMissingValues(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;

    expect(row.currentActiveMemberCount).toBe(3);
    expect(row.recordedActiveMemberCount).toBe(1);
    expect(row.missingActiveMemberCount).toBe(2);
  });

  it("detects an added metric and a changed weight between two comparable periods", async () => {
    const fixture = await createAllianceWithChangedMetricBetweenPeriods(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const section = report.alliances[0]!;

    expect(section.comparablePeriods.comparablePairCount).toBe(1);
    expect(section.metricStability.metricsAddedCount).toBe(1);
    expect(section.metricStability.weightChangedCount).toBe(1);
  });

  it("counts negative and zero values in the real distribution query", async () => {
    const fixture = await createAllianceWithNegativeValues(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;
    expect(row.section.kind).toBe("NUMERIC");
    if (row.section.kind === "NUMERIC" && !row.section.distribution.suppressed) {
      expect(row.section.distribution.value.negativeCount).toBe(2);
      expect(row.section.distribution.value.zeroCount).toBe(1);
    }
  });

  it("suppresses a sparse period's distribution rather than showing an exact value from a near-empty cohort", async () => {
    const fixture = await createAllianceWithSparsePeriod(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;
    expect(row.currentActiveMemberCount).toBe(10);
    expect(row.recordedActiveMemberCount).toBe(1);
    expect(row.section.kind).toBe("NUMERIC");
    if (row.section.kind === "NUMERIC") {
      expect(row.section.distribution.suppressed).toBe(true);
    }
  });
});
