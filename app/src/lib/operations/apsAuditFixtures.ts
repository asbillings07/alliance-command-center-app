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

  const values = [-50, -10, 0, 20, 80];
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
 * One BOOLEAN metric with a mix of true/false/invalid active values, plus
 * one archived member whose still-valid latest value contributes to the
 * true/false counts. Exercises the boolean coverage/count split (invalid
 * counts live only in `coverage`, never duplicated into the boolean
 * section) with enough contributors (>= MIN_CELL_SIZE) to stay unsuppressed.
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

  // 3 true, 2 false, 1 invalid (legacy non-0/1 value) among active members.
  const activeValues = [1, 1, 1, 0, 0, 7];
  const activeMembers = await Promise.all(
    activeValues.map((_, index) => prisma.allianceMember.create({ data: { allianceId: alliance.id, playerName: `Active ${index}` } })),
  );
  await Promise.all(
    activeMembers.map((member, index) =>
      prisma.memberMetricEntry.create({
        data: { allianceMemberId: member.id, periodId: period.id, metricId: metric.id, value: activeValues[index]! },
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
