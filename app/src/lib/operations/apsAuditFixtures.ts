/**
 * Synthetic fixtures for APS discovery (#284 PR A) edge cases that a small,
 * bounded Founder Beta sample may not reliably exhibit on its own: missing
 * values, a metric changed between periods, negative values, and a sparse
 * (low-coverage) period. These are database-backed builders (using the
 * normal, read-write `PrismaClient` — they exist to set up test data, not
 * to run inside the read-only audit itself) used by
 * `apsDataReadinessAudit.integration.test.ts`, and are exported so
 * ADR-017's worked examples can reference the exact same scenarios rather
 * than inventing parallel ones.
 *
 * `ZERO_VALUED_TARGET_WORKED_EXAMPLE` is deliberately NOT database-backed —
 * "target" is a normalization concept ADR-017 has not yet defined a schema
 * for, so this is plain illustrative data for that future worked example,
 * not a fixture this audit's queries can exercise today.
 */
import type { PrismaClient } from "@/app/generated/prisma/client";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

async function createAlliance(prisma: PrismaClient, label: string) {
  return prisma.alliance.create({ data: { name: `APS Fixture ${label} ${uniqueSuffix()}`, server: "9999" } });
}

/**
 * One numeric metric attached to one period; three active members, only one
 * of whom recorded a value. Exercises `missingActiveMemberCount` > 0.
 */
export async function createAllianceWithMissingValues(prisma: PrismaClient) {
  const alliance = await createAlliance(prisma, "MissingValues");
  const period = await prisma.metricPeriod.create({
    data: {
      allianceId: alliance.id,
      name: "Week 1",
      startsAt: new Date("2026-01-01"),
      endsAt: new Date("2026-01-08"),
      active: true,
    },
  });
  const metric = await prisma.metric.create({
    data: {
      allianceId: alliance.id,
      name: "Fixture Metric",
      type: Metric_Type.NUMERIC,
      summaryKind: MetricSummaryKind.SUM,
      trendDirection: MetricTrendDirection.HIGHER_IS_BETTER,
    },
  });
  await prisma.metricPeriodMetric.create({
    data: { periodId: period.id, metricId: metric.id, weight: 10, required: true, active: true },
  });

  const members = await Promise.all(
    ["Alpha", "Bravo", "Charlie"].map((name) =>
      prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: name } }),
    ),
  );
  await prisma.memberMetricEntry.create({
    data: { allianceMemberId: members[0]!.id, periodId: period.id, metricId: metric.id, value: 42 },
  });

  return { allianceId: alliance.id, periodId: period.id, metricId: metric.id, memberIds: members.map((m) => m.id) };
}

/**
 * Two comparable (equal-duration, non-overlapping) dated periods. Metric A
 * is attached+weighted in both; Metric B is only attached in the second.
 * Exercises `metricStability`'s added/weight-changed detection.
 */
export async function createAllianceWithChangedMetricBetweenPeriods(prisma: PrismaClient) {
  const alliance = await createAlliance(prisma, "ChangedMetric");
  const periodOne = await prisma.metricPeriod.create({
    data: {
      allianceId: alliance.id,
      name: "Week 1",
      startsAt: new Date("2026-01-01"),
      endsAt: new Date("2026-01-08"),
      active: true,
    },
  });
  const periodTwo = await prisma.metricPeriod.create({
    data: {
      allianceId: alliance.id,
      name: "Week 2",
      startsAt: new Date("2026-01-09"),
      endsAt: new Date("2026-01-16"),
      active: true,
    },
  });

  const metricA = await prisma.metric.create({
    data: { allianceId: alliance.id, name: "Fixture Metric A", type: Metric_Type.NUMERIC, summaryKind: MetricSummaryKind.SUM },
  });
  const metricB = await prisma.metric.create({
    data: { allianceId: alliance.id, name: "Fixture Metric B", type: Metric_Type.NUMERIC, summaryKind: MetricSummaryKind.SUM },
  });

  await prisma.metricPeriodMetric.create({
    data: { periodId: periodOne.id, metricId: metricA.id, weight: 5, required: false, active: true },
  });
  await prisma.metricPeriodMetric.create({
    data: { periodId: periodTwo.id, metricId: metricA.id, weight: 15, required: false, active: true },
  });
  await prisma.metricPeriodMetric.create({
    data: { periodId: periodTwo.id, metricId: metricB.id, weight: 5, required: false, active: true },
  });

  return {
    allianceId: alliance.id,
    periodOneId: periodOne.id,
    periodTwoId: periodTwo.id,
    metricAId: metricA.id,
    metricBId: metricB.id,
  };
}

/** One numeric metric with a mix of negative and positive recorded values. */
/**
 * 20 values: 5 negative, 0 zero, 15 positive, none an outlier by the Tukey
 * fence. Every category count (negative/zero/outlier) is either 0 or
 * >= MIN_CELL_SIZE so the row is genuinely unsuppressed, unlike a smaller
 * sample where e.g. exactly one negative value would itself be a
 * small-cell disclosure (see `suppressCorrelatedCounts`).
 */
export async function createAllianceWithNegativeValues(prisma: PrismaClient) {
  const alliance = await createAlliance(prisma, "NegativeValues");
  const period = await prisma.metricPeriod.create({
    data: {
      allianceId: alliance.id,
      name: "Week 1",
      startsAt: new Date("2026-01-01"),
      endsAt: new Date("2026-01-08"),
      active: true,
    },
  });
  const metric = await prisma.metric.create({
    data: { allianceId: alliance.id, name: "Fixture Metric", type: Metric_Type.NUMERIC, summaryKind: MetricSummaryKind.SUM },
  });
  await prisma.metricPeriodMetric.create({
    data: { periodId: period.id, metricId: metric.id, weight: 1, required: false, active: true },
  });

  const values = [
    -50, -40, -30, -20, -10, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120, 130, 140, 150,
  ];
  const members = await Promise.all(
    values.map((_, index) => prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: `Member ${index}` } })),
  );
  await Promise.all(
    members.map((member, index) =>
      prisma.memberMetricEntry.create({
        data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: values[index]! },
      }),
    ),
  );

  return { allianceId: alliance.id, periodId: period.id, metricId: metric.id };
}

/** A period where only a small minority of active members recorded a value — low coverage. */
export async function createAllianceWithSparsePeriod(prisma: PrismaClient) {
  const alliance = await createAlliance(prisma, "SparsePeriod");
  const period = await prisma.metricPeriod.create({
    data: {
      allianceId: alliance.id,
      name: "Week 1",
      startsAt: new Date("2026-01-01"),
      endsAt: new Date("2026-01-08"),
      active: true,
    },
  });
  const metric = await prisma.metric.create({
    data: { allianceId: alliance.id, name: "Fixture Metric", type: Metric_Type.NUMERIC, summaryKind: MetricSummaryKind.SUM },
  });
  await prisma.metricPeriodMetric.create({
    data: { periodId: period.id, metricId: metric.id, weight: 1, required: false, active: true },
  });

  const members = await Promise.all(
    Array.from({ length: 10 }, (_, index) =>
      prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: `Member ${index}` } }),
    ),
  );
  // Only the first member recorded a value this period.
  await prisma.memberMetricEntry.create({
    data: { allianceMemberId: members[0]!.id, periodId: period.id, metricId: metric.id, value: 5 },
  });

  return { allianceId: alliance.id, periodId: period.id, metricId: metric.id, memberCount: members.length };
}

/**
 * One BOOLEAN metric with active AND archived contributors, each population
 * (active recorded, active missing, archived contributing, combined
 * true/false total) at or above `MIN_CELL_SIZE` so none of the correlated
 * counts trip small-cell suppression -- exercises the "genuinely safe to
 * show everything" case with real numbers to check.
 */
export async function createAllianceWithBooleanValues(prisma: PrismaClient) {
  const alliance = await createAlliance(prisma, "BooleanValues");
  const period = await prisma.metricPeriod.create({
    data: {
      allianceId: alliance.id,
      name: "Week 1",
      startsAt: new Date("2026-01-01"),
      endsAt: new Date("2026-01-08"),
      active: true,
    },
  });
  const metric = await prisma.metric.create({
    data: { allianceId: alliance.id, name: "Fixture Metric", type: Metric_Type.BOOLEAN, summaryKind: MetricSummaryKind.TRUE_RATE },
  });
  await prisma.metricPeriodMetric.create({
    data: { periodId: period.id, metricId: metric.id, weight: 1, required: false, active: true },
  });

  // 20 active members: 10 true, 5 false (15 recorded), 5 missing, 0 invalid.
  const activeValues: (number | null)[] = [...Array(10).fill(1), ...Array(5).fill(0), ...Array(5).fill(null)];
  const activeMembers = await Promise.all(
    activeValues.map((_, index) => prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: `Active ${index}` } })),
  );
  await Promise.all(
    activeMembers.map((member, index) => {
      const value = activeValues[index];
      if (value === null) return Promise.resolve();
      return prisma.memberMetricEntry.create({
        data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value },
      });
    }),
  );

  // 5 archived members, all still contributing a valid value: 3 true, 2 false.
  const archivedValues = [1, 1, 1, 0, 0];
  const archivedMembers = await Promise.all(
    archivedValues.map((_, index) =>
      prisma.allianceMember.create({
        data: { allianceId: alliance.id, playerName: `Archived ${index}`, archivedAt: new Date("2026-01-05") },
      }),
    ),
  );
  await Promise.all(
    archivedMembers.map((member, index) =>
      prisma.memberMetricEntry.create({
        data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: archivedValues[index]! },
      }),
    ),
  );

  return { allianceId: alliance.id, periodId: period.id, metricId: metric.id };
}

/**
 * A large, otherwise entirely unsuppressed active cohort (20 recorded, 0
 * invalid, 0 missing) alongside exactly ONE archived contributor. Exercises
 * the anti-subtraction fix directly against real PostgreSQL: coverage
 * (20/20) and the boolean total (21) are each individually "large," but the
 * archived count (1) is a small positive cell shared by the same row --
 * the whole row must suppress, not just `archivedContributingMemberCount`.
 */
export async function createAllianceWithSmallArchivedCohort(prisma: PrismaClient) {
  const alliance = await createAlliance(prisma, "SmallArchivedCohort");
  const period = await prisma.metricPeriod.create({
    data: {
      allianceId: alliance.id,
      name: "Week 1",
      startsAt: new Date("2026-01-01"),
      endsAt: new Date("2026-01-08"),
      active: true,
    },
  });
  const metric = await prisma.metric.create({
    data: { allianceId: alliance.id, name: "Fixture Metric", type: Metric_Type.BOOLEAN, summaryKind: MetricSummaryKind.TRUE_RATE },
  });
  await prisma.metricPeriodMetric.create({
    data: { periodId: period.id, metricId: metric.id, weight: 1, required: false, active: true },
  });

  const activeMembers = await Promise.all(
    Array.from({ length: 20 }, (_, index) => prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: `Active ${index}` } })),
  );
  await Promise.all(
    activeMembers.map((member) =>
      prisma.memberMetricEntry.create({
        data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: 1 },
      }),
    ),
  );

  const archivedMember = await prisma.allianceMember.create({
    data: { allianceId: alliance.id, playerName: "Archived", archivedAt: new Date("2026-01-05") },
  });
  await prisma.memberMetricEntry.create({
    data: { allianceMemberId: archivedMember.id, periodId: period.id, metricId: metric.id, value: 1 },
  });

  return { allianceId: alliance.id, periodId: period.id, metricId: metric.id };
}

/**
 * Two metrics, each actively attached to three periods: one genuinely
 * dogfood-ready (a valid entry recorded in every period), one attached to
 * the same three periods but with zero entries ever recorded. Exercises
 * the dogfood-readiness distinction between "attached" and "has real data."
 */
export async function createAllianceWithAttachedButEmptyMetric(prisma: PrismaClient) {
  const alliance = await createAlliance(prisma, "AttachedButEmpty");
  const periods = await Promise.all(
    [
      { name: "Week 1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08") },
      { name: "Week 2", startsAt: new Date("2026-01-09"), endsAt: new Date("2026-01-16") },
      { name: "Week 3", startsAt: new Date("2026-01-17"), endsAt: new Date("2026-01-24") },
    ].map((data) => prisma.metricPeriod.create({ data: { allianceId: alliance.id, active: true, ...data } })),
  );

  const readyMetric = await prisma.metric.create({
    data: { allianceId: alliance.id, name: "Ready Metric", type: Metric_Type.NUMERIC, summaryKind: MetricSummaryKind.SUM },
  });
  const emptyMetric = await prisma.metric.create({
    data: { allianceId: alliance.id, name: "Empty Metric", type: Metric_Type.NUMERIC, summaryKind: MetricSummaryKind.SUM },
  });

  await Promise.all(
    periods.flatMap((period) => [
      prisma.metricPeriodMetric.create({ data: { periodId: period.id, metricId: readyMetric.id, weight: 1, required: false, active: true } }),
      prisma.metricPeriodMetric.create({ data: { periodId: period.id, metricId: emptyMetric.id, weight: 1, required: false, active: true } }),
    ]),
  );

  const member = await prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: "Solo" } });
  await Promise.all(
    periods.map((period) =>
      prisma.memberMetricEntry.create({
        data: { allianceMemberId: member.id, periodId: period.id, metricId: readyMetric.id, value: 10 },
      }),
    ),
  );
  // emptyMetric is attached to every period above but never gets an entry.

  return { allianceId: alliance.id, readyMetricId: readyMetric.id, emptyMetricId: emptyMetric.id };
}

/**
 * Two alliances, plus one deliberately inconsistent cross-tenant row: a
 * `MetricPeriodMetric` attaching alliance A's metric to alliance B's
 * period, with a real entry from an alliance-B member. Nothing at the
 * Prisma-relation level stops this from existing (there's no composite FK
 * enforcing metric/period same-alliance), so the dogfood-readiness query
 * must not let it inflate alliance A's readiness count -- see
 * `queryPeriodsWithValidDataCounts`'s explicit `allianceId` re-scoping.
 */
export async function createCrossTenantDogfoodAttachment(prisma: PrismaClient) {
  const allianceA = await createAlliance(prisma, "CrossTenantA");
  const allianceB = await createAlliance(prisma, "CrossTenantB");

  const metricA = await prisma.metric.create({
    data: { allianceId: allianceA.id, name: "Alliance A Metric", type: Metric_Type.NUMERIC, summaryKind: MetricSummaryKind.SUM },
  });
  // Alliance A has its OWN legitimate periods (so it has something to audit
  // besides the foreign one below), but the metric is never actually
  // attached to any of them with real data.
  const ownPeriods = await Promise.all(
    [
      { name: "A Week 1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08") },
      { name: "A Week 2", startsAt: new Date("2026-01-09"), endsAt: new Date("2026-01-16") },
    ].map((data) => prisma.metricPeriod.create({ data: { allianceId: allianceA.id, active: true, ...data } })),
  );

  const foreignPeriod = await prisma.metricPeriod.create({
    data: { allianceId: allianceB.id, name: "B Week 1", startsAt: new Date("2026-01-01"), endsAt: new Date("2026-01-08"), active: true },
  });
  const foreignMember = await prisma.allianceMember.create({ data: { allianceId: allianceB.id, playerName: "B Member" } });

  // The inconsistent cross-tenant attachment + entry.
  await prisma.metricPeriodMetric.create({
    data: { periodId: foreignPeriod.id, metricId: metricA.id, weight: 1, required: false, active: true },
  });
  await prisma.memberMetricEntry.create({
    data: { allianceMemberId: foreignMember.id, periodId: foreignPeriod.id, metricId: metricA.id, value: 10 },
  });

  return {
    allianceAId: allianceA.id,
    allianceBId: allianceB.id,
    metricAId: metricA.id,
    ownPeriodIds: ownPeriods.map((p) => p.id),
    foreignPeriodId: foreignPeriod.id,
  };
}

/**
 * Illustrative only — NOT database-backed. `target`/`floor`/`cap` do not
 * exist in the schema yet; this exists so ADR-017's normalization worked
 * examples have one concrete, reusable numeric scenario to reference for a
 * zero-valued, lower-is-better target rather than each example inventing
 * its own numbers.
 */
export const ZERO_VALUED_TARGET_WORKED_EXAMPLE = {
  description: "A LOWER_IS_BETTER metric (e.g. 'Missed Check-ins') whose leader-configured target is exactly zero.",
  trendDirection: MetricTrendDirection.LOWER_IS_BETTER,
  target: 0,
  observedValues: [0, 1, 3, 10],
} as const;
