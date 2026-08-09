import "server-only";
import { Prisma } from "@/app/generated/prisma/client";
import { MetricObservationGrain, MemberPeriodRollupKind } from "@/app/generated/prisma/enums";
import { prisma } from "@/app/src/lib/prisma";

/**
 * ADR-018 §5's provenance table, as a pure, static function of a metric's
 * own (creation-time-immutable) configuration - never inferred from
 * whether any observation happens to exist. A `DAILY_OBSERVATION + SUM`
 * metric with only one observation is still "Derived (sum)", not
 * reclassified as a source value merely because one row contributed.
 *
 * Deliberately split out from the SQL below (mirroring `metricRollup.ts`'s
 * split from `getMetricSummaryReport.ts`) so this label logic is
 * independently unit-testable without a database.
 */
export type MemberPeriodMetricProvenance =
  | "Source period value"
  | "Derived (latest observation)"
  | "Derived (sum)"
  | "Derived (average)";

export function deriveMemberPeriodMetricProvenance(
  observationGrain: MetricObservationGrain,
  memberPeriodRollup: MemberPeriodRollupKind,
): MemberPeriodMetricProvenance {
  if (observationGrain === MetricObservationGrain.PERIOD_VALUE) {
    return "Source period value";
  }
  switch (memberPeriodRollup) {
    case MemberPeriodRollupKind.LATEST:
      return "Derived (latest observation)";
    case MemberPeriodRollupKind.SUM:
      return "Derived (sum)";
    case MemberPeriodRollupKind.AVERAGE:
      return "Derived (average)";
  }
}

export type MemberPeriodMetricValue = {
  metricId: string;
  allianceMemberId: string;
  value: number | null;
  /** Active winning slots only - never a raw row count (ADR-018 §5). */
  observationCount: number;
  /** Null when observationCount is 0. */
  lastObservedOn: Date | null;
  provenance: MemberPeriodMetricProvenance;
};

type RawRow = {
  metric_id: string;
  alliance_member_id: string;
  value: number | null;
  observation_count: bigint;
  // Selected as text (`to_char`), not a raw DATE, and parsed manually below
  // - node-postgres's default DATE parser anchors to the server process's
  // local time zone, which would silently shift the calendar day for any
  // deployment not running with TZ=UTC. ADR-018 §4's "never shifted by a
  // day" contract applies to every observedOn round trip, reads included.
  last_observed_on: string | null;
  observation_grain: MetricObservationGrain;
  member_period_rollup: MemberPeriodRollupKind;
};

/** `YYYY-MM-DD` -> explicit UTC midnight, never `new Date(rawString)`. */
function parseCivilDateToUtcMidnight(civilDate: string): Date {
  const [year, month, day] = civilDate.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

/**
 * ADR-018 §6's single canonical read model - per (member, metric): the
 * derived value, active-slot `observationCount`, `lastObservedOn`, and a
 * static provenance label. This is the one place "latest wins" /
 * "member-period rollup" is computed; every consumer listed in the #287
 * database design §8 migrates to this function rather than re-implementing
 * its own `DISTINCT ON` query (see that section for the exhaustive list and
 * per-query migration status).
 *
 * Two-phase computation, matching ADR-018 §1 exactly:
 *   Phase 1 (`slot_winner`) - within each `(metricId, allianceMemberId,
 *     observedOn)` slot, `(recordedAt, createdAt, id)` DESC picks the one
 *     winning row, *regardless* of status - a later VOIDED row must beat an
 *     earlier ACTIVE one for the same slot before status is ever consulted.
 *   Phase 2 (`active_slots` onward) - only ACTIVE winning slots contribute
 *     to LATEST/SUM/AVERAGE; a voided or missing date contributes to
 *     neither (never treated as 0).
 *
 * Every requested (metric, alliance member) pair is returned via the `base`
 * cross join, even one with zero active winning slots - `value` is `NULL`,
 * never absent from the result set and never coerced to 0.
 *
 * Tenant-scoped twice, independently: `metricIds` is filtered down to
 * metrics that actually belong to `allianceId` inside `requested_metrics`
 * (a foreign-tenant id is silently dropped, never smuggled into the cross
 * join below), and the member roster (`base`'s `CROSS JOIN`) is separately
 * scoped to the same `allianceId`. Callers must already have verified the
 * acting user has access to `allianceId`, matching every other
 * alliance-scoped read model in the app (e.g. `getMetricSummaryReport.ts`).
 *
 * No separate "drill-down handle" is returned: a caller already has
 * `periodId` (an input) plus each row's `metricId`/`allianceMemberId`,
 * which is exactly what a bounded, paginated drill-down query into the raw
 * `MemberMetricEntry` ledger needs - inventing a synthetic token here would
 * duplicate that identity for no benefit.
 *
 * `options.onlyParticipating` (default `false`) restricts the result to
 * rows with at least one active winning slot (`observationCount > 0`),
 * pushing a consumer's own "I only care who participated" filter into SQL
 * instead of shipping the full (metrics × roster) cross join to Node just
 * to throw most of it away (e.g. `getPeriodResultsSummary.ts`). This is
 * one additional `WHERE` on the same query, not a second implementation -
 * every other invariant above is unchanged, and the default (`false`)
 * preserves the full cross join for consumers that need every member's row
 * even when empty (e.g. a report roster).
 */
export async function memberPeriodMetricValues(
  allianceId: string,
  periodId: string,
  metricIds: readonly string[],
  options?: { onlyParticipating?: boolean },
): Promise<MemberPeriodMetricValue[]> {
  const uniqueMetricIds = [...new Set(metricIds)];
  if (uniqueMetricIds.length === 0) return [];

  const onlyParticipatingFilter = options?.onlyParticipating
    ? Prisma.sql`WHERE apm."metricId" IS NOT NULL`
    : Prisma.empty;

  const rows = await prisma.$queryRaw<RawRow[]>`
    WITH slot_winner AS (
      SELECT DISTINCT ON (mme."metricId", mme."allianceMemberId", mme."observedOn")
        mme."metricId", mme."allianceMemberId", mme."observedOn", mme."value", mme."status"
      FROM "MemberMetricEntry" mme
      JOIN "AllianceMember" am ON am.id = mme."allianceMemberId"
      WHERE am."allianceId" = ${allianceId}
        AND mme."periodId" = ${periodId}
        AND mme."metricId" IN (${Prisma.join(uniqueMetricIds)})
      ORDER BY mme."metricId", mme."allianceMemberId", mme."observedOn",
        mme."recordedAt" DESC, mme."createdAt" DESC, mme."id" DESC
    ),
    active_slots AS (
      SELECT * FROM slot_winner WHERE "status" = 'ACTIVE'
    ),
    latest_per_member AS (
      SELECT DISTINCT ON ("metricId", "allianceMemberId")
        "metricId", "allianceMemberId", "value"
      FROM active_slots
      ORDER BY "metricId", "allianceMemberId", "observedOn" DESC NULLS LAST
    ),
    aggregated_per_member AS (
      SELECT "metricId", "allianceMemberId",
        SUM("value")::float8 AS sum_value,
        AVG("value")::float8 AS avg_value,
        COUNT(*)::bigint AS observation_count,
        to_char(MAX("observedOn"), 'YYYY-MM-DD') AS last_observed_on
      FROM active_slots
      GROUP BY "metricId", "allianceMemberId"
    ),
    requested_metrics AS (
      SELECT "id", "observationGrain", "memberPeriodRollup"
      FROM "Metric"
      WHERE "allianceId" = ${allianceId} AND "id" IN (${Prisma.join(uniqueMetricIds)})
    ),
    base AS (
      SELECT rm."id" AS "metricId", am."id" AS "allianceMemberId",
        rm."observationGrain", rm."memberPeriodRollup"
      FROM requested_metrics rm
      CROSS JOIN "AllianceMember" am
      WHERE am."allianceId" = ${allianceId}
    )
    SELECT
      b."metricId" AS metric_id,
      b."allianceMemberId" AS alliance_member_id,
      CASE b."memberPeriodRollup"
        WHEN 'LATEST' THEN lpm."value"::float8
        WHEN 'SUM' THEN apm.sum_value
        WHEN 'AVERAGE' THEN apm.avg_value
      END AS value,
      COALESCE(apm.observation_count, 0)::bigint AS observation_count,
      apm.last_observed_on AS last_observed_on,
      b."observationGrain" AS observation_grain,
      b."memberPeriodRollup" AS member_period_rollup
    FROM base b
    LEFT JOIN latest_per_member lpm
      ON lpm."metricId" = b."metricId" AND lpm."allianceMemberId" = b."allianceMemberId"
    LEFT JOIN aggregated_per_member apm
      ON apm."metricId" = b."metricId" AND apm."allianceMemberId" = b."allianceMemberId"
    ${onlyParticipatingFilter}
    ORDER BY b."metricId", b."allianceMemberId"
  `;

  return rows.map((row) => ({
    metricId: row.metric_id,
    allianceMemberId: row.alliance_member_id,
    value: row.value,
    observationCount: Number(row.observation_count),
    lastObservedOn: row.last_observed_on ? parseCivilDateToUtcMidnight(row.last_observed_on) : null,
    provenance: deriveMemberPeriodMetricProvenance(row.observation_grain, row.member_period_rollup),
  }));
}
