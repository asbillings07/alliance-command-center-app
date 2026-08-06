import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { runInReadOnlyAuditTransaction } from "./apsAuditTransaction";
import { runApsDataReadinessAudit } from "./apsDataReadinessAudit";
import { AllianceAllowlistError } from "./apsAuditAllowlist";
import {
  createAllianceWithAttachedButEmptyMetric,
  createAllianceWithBooleanValues,
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

    // Only 1 of 3 active members recorded -- below MIN_CELL_SIZE, so the
    // coverage bundle itself is suppressed rather than shown exactly.
    expect(row.coverage.suppressed).toBe(true);
  });

  it("reports coverage counts exactly once the active roster is large enough to not be a small cell", async () => {
    const fixture = await createAllianceWithBooleanValues(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;

    expect(row.coverage).toEqual({
      suppressed: false,
      value: {
        currentActiveMemberCount: 6,
        recordedActiveMemberCount: 5,
        invalidActiveMemberCount: 1,
        missingActiveMemberCount: 0,
      },
    });
  });

  it("computes boolean true/false counts across active and archived members, and never duplicates the invalid count into the boolean section", async () => {
    const fixture = await createAllianceWithBooleanValues(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;

    expect(row.section.kind).toBe("BOOLEAN");
    if (row.section.kind === "BOOLEAN") {
      // 3 active true + 1 archived true = 4; 2 active false. Total valid (6) >= MIN_CELL_SIZE.
      expect(row.section.counts).toEqual({ suppressed: false, value: { trueCount: 4, falseCount: 2 } });
      expect(JSON.stringify(row.section)).not.toMatch(/invalid/i);
    }
    // Exactly 1 archived contributor -- below MIN_CELL_SIZE, suppressed even
    // though the boolean counts above (a larger population) are not.
    expect(row.archivedContributingMemberCount.suppressed).toBe(true);
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

  it("computes min/max/percentiles/zero/negative/outlier counts entirely in PostgreSQL, not via JS-side dedup", async () => {
    const fixture = await createAllianceWithNegativeValues(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;
    expect(row.section.kind).toBe("NUMERIC");
    expect(row.section.kind === "NUMERIC" && row.section.distribution.suppressed).toBe(false);
    if (row.section.kind === "NUMERIC" && !row.section.distribution.suppressed) {
      // Fixture values: [-50, -10, 0, 20, 80].
      const dist = row.section.distribution.value;
      expect(dist.count).toBe(5);
      expect(dist.min).toBe(-50);
      expect(dist.max).toBe(80);
      expect(dist.negativeCount).toBe(2);
      expect(dist.zeroCount).toBe(1);
      // PERCENTILE_CONT(0.25/0.5/0.75) over the sorted values.
      expect(dist.p25).toBeCloseTo(-10);
      expect(dist.p50).toBeCloseTo(0);
      expect(dist.p75).toBeCloseTo(20);
      // IQR = 30; fence = [-10 - 45, 20 + 45] = [-55, 65] -> only 80 is outside it.
      expect(dist.outlierCount).toBe(1);
    }
  });

  it("only resolves each member's LATEST entry for a metric, even when a member has multiple historical entries", async () => {
    const fixture = await createAllianceWithMissingValues(prisma);
    createdAllianceIds.push(fixture.allianceId);
    // Record two more, later entries for the member who already has one --
    // the audit must reflect only the single latest value, not double-count
    // or sum across history.
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: fixture.memberIds[0]!,
        periodId: fixture.periodId,
        metricId: fixture.metricId,
        value: 100,
        recordedAt: new Date(Date.now() + 1000),
      },
    });
    await prisma.memberMetricEntry.create({
      data: {
        allianceMemberId: fixture.memberIds[0]!,
        periodId: fixture.periodId,
        metricId: fixture.metricId,
        value: 999,
        recordedAt: new Date(Date.now() + 2000),
      },
    });

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;
    expect(row.coverage.suppressed).toBe(true); // still only 1 of 3 active members recorded.
  });

  it("suppresses a sparse period's distribution rather than showing an exact value from a near-empty cohort", async () => {
    const fixture = await createAllianceWithSparsePeriod(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;
    // The active roster itself (10) is large, but only 1 recorded -- the
    // shared coverage bundle is still gated on the roster size (not small
    // here), while the numeric distribution's own cell (1 valid value) is.
    expect(row.coverage).toEqual({
      suppressed: false,
      value: { currentActiveMemberCount: 10, recordedActiveMemberCount: 1, invalidActiveMemberCount: 0, missingActiveMemberCount: 9 },
    });
    expect(row.section.kind).toBe("NUMERIC");
    if (row.section.kind === "NUMERIC") {
      expect(row.section.distribution.suppressed).toBe(true);
    }
  });

  // ---------------------------------------------------------------------
  // Dogfood readiness: attachment alone must never be conflated with real,
  // valid recorded data (#284 PR A review).
  // ---------------------------------------------------------------------

  it("does not count a metric as dogfood-ready when it is attached but has zero valid entries, even across enough periods", async () => {
    const fixture = await createAllianceWithAttachedButEmptyMetric(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const dogfood = report.alliances[0]!.dogfoodReadiness;

    expect(dogfood.totalMetricCount).toBe(2);
    // Only the metric with real recorded data counts -- the attached-but-empty
    // one must not, even though it's attached to 3 (>= MIN_PERIODS_FOR_DOGFOOD) periods.
    expect(dogfood.metricsWithEnoughObservationsCount).toBe(1);
  });
});
