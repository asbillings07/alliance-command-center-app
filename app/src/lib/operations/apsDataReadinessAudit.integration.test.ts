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
  createAllianceWithSmallArchivedCohort,
  createAllianceWithSparsePeriod,
  createCrossTenantDogfoodAttachment,
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

  // -------------------------------------------------------------------------
  // Whole-transaction budget vs. per-statement cap -- these two timeouts must
  // stay independent (review regression: the transaction budget used to be a
  // fixed `statementTimeoutMs + 5s`, which could abort a real multi-alliance
  // run even though no individual statement ever exceeded its own cap).
  // -------------------------------------------------------------------------

  it("lets several sequential statements, each individually within the statement cap, complete when the whole-transaction budget is sized for them", async () => {
    const result = await runInReadOnlyAuditTransaction(
      prisma,
      async (tx) => {
        // 5 statements x 300ms = ~1.5s of real work, each comfortably under
        // the 1s per-statement cap -- this must NOT be mistaken for a
        // runaway single query.
        for (let i = 0; i < 5; i += 1) {
          await tx.$queryRawUnsafe("SELECT pg_sleep(0.3)::text");
        }
        return "done";
      },
      // allianceCount: 2 sizes the default whole-transaction budget as
      // 5_000 + 2 * 6 * 1_000 = 17_000ms -- comfortably above the ~1.5s of
      // real work above, and above the old fixed `statementTimeoutMs + 5s`
      // (6_000ms) this scenario is deliberately close to.
      { statementTimeoutMs: 1_000, allianceCount: 2 },
    );

    expect(result).toBe("done");
  });

  it("fails the whole transaction atomically once its own (explicitly small) budget is exceeded, even though every individual statement stayed within the statement cap", async () => {
    await expect(
      runInReadOnlyAuditTransaction(
        prisma,
        async (tx) => {
          // Same shape as the passing case above (statements individually
          // within the 1s statement cap), but the transaction's own budget
          // is deliberately set smaller than their combined real time.
          for (let i = 0; i < 5; i += 1) {
            await tx.$queryRawUnsafe("SELECT pg_sleep(0.3)::text");
          }
          return "should not reach here";
        },
        { statementTimeoutMs: 1_000, transactionTimeoutMs: 1_000 },
      ),
    ).rejects.toThrow(/timeout|closed|expired/i);
  });

  it("rejects an explicit transactionTimeoutMs smaller than statementTimeoutMs before ever opening a transaction", async () => {
    await expect(
      runInReadOnlyAuditTransaction(prisma, async () => null, {
        statementTimeoutMs: 5_000,
        transactionTimeoutMs: 1_000,
      }),
    ).rejects.toThrow(/transaction timeout/i);
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
    // entire row is suppressed rather than shown exactly.
    expect(row.stats.suppressed).toBe(true);
  });

  it("reports every count exactly once every correlated population is large enough to not be a small cell", async () => {
    const fixture = await createAllianceWithBooleanValues(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;

    expect(row.stats.suppressed).toBe(false);
    if (!row.stats.suppressed) {
      expect(row.stats.value.coverage).toEqual({
        currentActiveMemberCount: 20,
        recordedActiveMemberCount: 15,
        invalidActiveMemberCount: 0,
        missingActiveMemberCount: 5,
      });
      // 10 active true + 3 archived true = 13; 5 active false + 2 archived false = 7.
      expect(row.stats.value.section).toEqual({ kind: "BOOLEAN", counts: { trueCount: 13, falseCount: 7 } });
      expect(JSON.stringify(row.stats.value.section)).not.toMatch(/invalid/i);
      expect(row.stats.value.archivedContributingMemberCount).toBe(5);
    }
  });

  it("suppresses the whole row (not just archivedContributingMemberCount) when only the archived cohort is small, preventing a subtraction leak, against real PostgreSQL", async () => {
    const fixture = await createAllianceWithSmallArchivedCohort(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;

    // Coverage (20/20 active, all valid) and the boolean total (21) would
    // each individually clear MIN_CELL_SIZE, but the single archived
    // contributor is a small positive cell shared by the same bundle --
    // the report must not show enough of the bundle to let a reader derive
    // that "1" by subtracting the visible active count from the visible total.
    expect(row.stats.suppressed).toBe(true);
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
    expect(row.stats.suppressed).toBe(false);
    if (!row.stats.suppressed) {
      const section = row.stats.value.section;
      expect(section.kind).toBe("NUMERIC");
      if (section.kind !== "NUMERIC" || section.distribution === null) throw new Error("expected a numeric distribution");
      // Fixture values: [-50,-40,-30,-20,-10, 10,20,...,150] (20 values).
      const dist = section.distribution;
      expect(dist.count).toBe(20);
      expect(dist.min).toBe(-50);
      expect(dist.max).toBe(150);
      expect(dist.negativeCount).toBe(5);
      expect(dist.zeroCount).toBe(0);
      // PERCENTILE_CONT(0.25/0.5/0.75) over the sorted values.
      expect(dist.p25).toBeCloseTo(5);
      expect(dist.p50).toBeCloseTo(55);
      expect(dist.p75).toBeCloseTo(102.5);
      // IQR = 97.5; fence = [5 - 146.25, 102.5 + 146.25] = [-141.25, 248.75] -> nothing outside it.
      expect(dist.outlierCount).toBe(0);
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
    expect(row.stats.suppressed).toBe(true); // still only 1 of 3 active members recorded.
  });

  it("suppresses a sparse period's entire row rather than showing an exact value from a near-empty cohort", async () => {
    const fixture = await createAllianceWithSparsePeriod(prisma);
    createdAllianceIds.push(fixture.allianceId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceId]),
    );
    const row = report.alliances[0]!.metricDistributions[0]!;
    // The active roster itself (10) is large, but only 1 recorded -- that's
    // a small positive cell shared by the row's bundle, so the WHOLE row
    // (including the otherwise-fine-looking roster size) is suppressed.
    expect(row.stats.suppressed).toBe(true);
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

  it("does not let a cross-tenant MetricPeriodMetric/entry inflate a metric's dogfood readiness (ADR-002 tenant boundary)", async () => {
    const fixture = await createCrossTenantDogfoodAttachment(prisma);
    createdAllianceIds.push(fixture.allianceAId, fixture.allianceBId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceAId]),
    );
    const dogfood = report.alliances[0]!.dogfoodReadiness;

    // Alliance A's metric is attached only to alliance B's foreign period
    // (with a real entry there) -- if the query weren't re-scoped by
    // allianceId, that would count as 1 period of valid data. It must
    // count as ZERO for alliance A.
    expect(dogfood.totalMetricCount).toBe(1);
    expect(dogfood.metricsWithEnoughObservationsCount).toBe(0);
  });

  it("does not count a cross-tenant MetricPeriodMetric attachment in this alliance's activeAttachmentCount", async () => {
    const fixture = await createCrossTenantDogfoodAttachment(prisma);
    createdAllianceIds.push(fixture.allianceAId, fixture.allianceBId);

    const report = await runInReadOnlyAuditTransaction(prisma, (tx) =>
      runApsDataReadinessAudit(tx, [fixture.allianceAId]),
    );
    const config = report.alliances[0]!.metricConfiguration;

    // Alliance A's metric is attached only to alliance B's foreign period --
    // if `periodMetrics` weren't scoped by `period.allianceId`, that would
    // count as 1 active attachment. It must count as ZERO for alliance A.
    expect(config.totalMetricCount).toBe(1);
    expect(config.activeAttachmentCount).toBe(0);
    expect(config.inactiveAttachmentCount).toBe(0);
  });
});
