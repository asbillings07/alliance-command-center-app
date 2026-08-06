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
