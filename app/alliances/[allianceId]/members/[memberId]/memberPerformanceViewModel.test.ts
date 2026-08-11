import { describe, it, expect } from "vitest";
import { MetricTrendDirection } from "@/app/generated/prisma/enums";
import {
  buildCurrentMetricViewModels,
  buildPeriodTrendViewModels,
  type RawMemberMetricEntry,
  type RollupMetricValue,
  type PeriodMetricInput,
} from "./memberPerformanceViewModel";

function entry(overrides: Partial<RawMemberMetricEntry> & { metricId: string }): RawMemberMetricEntry {
  return {
    value: 100,
    recordedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    id: "entry_default",
    ...overrides,
  };
}

// buildCurrentMetricViewModels ignores trendDirection entirely (it's
// buildPeriodTrendViewModels' concern) - NEUTRAL here is an arbitrary,
// irrelevant-to-this-describe-block default, not a claim about what these
// metrics are configured as in reality.
function metricInput(
  metricId: string,
  metricName: string,
  trendDirection: MetricTrendDirection = MetricTrendDirection.NEUTRAL,
): PeriodMetricInput {
  return { metricId, metricName, trendDirection };
}

const periodMetrics = [metricInput("met_kill", "Kill Points")];

describe("buildCurrentMetricViewModels", () => {
  it("returns undefined current/previous/delta when there are no entries for a metric", () => {
    const [row] = buildCurrentMetricViewModels(periodMetrics, []);

    expect(row).toEqual({
      metricId: "met_kill",
      metricName: "Kill Points",
      current: undefined,
      previous: undefined,
      delta: undefined,
    });
  });

  it("with exactly one entry, sets current and leaves previous/delta undefined", () => {
    const [row] = buildCurrentMetricViewModels(periodMetrics, [
      entry({ metricId: "met_kill", value: 500, id: "e1" }),
    ]);

    expect(row.current).toEqual({ value: 500, recordedAt: new Date("2026-01-01T00:00:00Z") });
    expect(row.previous).toBeUndefined();
    expect(row.delta).toBeUndefined();
  });

  it("orders by recordedAt desc: the most recent entry is current, the second-most-recent is previous", () => {
    const [row] = buildCurrentMetricViewModels(periodMetrics, [
      entry({ metricId: "met_kill", value: 900000, recordedAt: new Date("2026-07-23T10:00:00Z"), id: "e_older" }),
      entry({ metricId: "met_kill", value: 1250000, recordedAt: new Date("2026-07-24T10:00:00Z"), id: "e_newer" }),
    ]);

    expect(row.current?.value).toBe(1250000);
    expect(row.previous?.value).toBe(900000);
    expect(row.delta).toBe(1250000 - 900000);
  });

  it("only ever considers the two most recent entries, ignoring older ones entirely", () => {
    const [row] = buildCurrentMetricViewModels(periodMetrics, [
      entry({ metricId: "met_kill", value: 100, recordedAt: new Date("2026-01-01T00:00:00Z"), id: "e1" }),
      entry({ metricId: "met_kill", value: 200, recordedAt: new Date("2026-01-02T00:00:00Z"), id: "e2" }),
      entry({ metricId: "met_kill", value: 300, recordedAt: new Date("2026-01-03T00:00:00Z"), id: "e3" }),
    ]);

    expect(row.current?.value).toBe(300);
    expect(row.previous?.value).toBe(200);
    // The oldest entry (100) is never surfaced, in current or previous.
    expect(row.delta).toBe(100);
  });

  // Tie-break ordering: when recordedAt is identical, fall back to
  // createdAt, then id - the same deterministic precedence every writer
  // uses (ADR-018 §4), so this pick can never depend on unspecified SQL
  // result order for ties.
  it("breaks a recordedAt tie using createdAt", () => {
    const sameRecordedAt = new Date("2026-01-01T00:00:00Z");
    const [row] = buildCurrentMetricViewModels(periodMetrics, [
      entry({ metricId: "met_kill", value: 100, recordedAt: sameRecordedAt, createdAt: new Date("2026-01-01T00:00:00Z"), id: "e_first" }),
      entry({ metricId: "met_kill", value: 200, recordedAt: sameRecordedAt, createdAt: new Date("2026-01-01T00:00:01Z"), id: "e_second" }),
    ]);

    expect(row.current?.value).toBe(200);
    expect(row.previous?.value).toBe(100);
  });

  it("breaks a recordedAt+createdAt tie using id", () => {
    const sameTimestamp = new Date("2026-01-01T00:00:00Z");
    const [row] = buildCurrentMetricViewModels(periodMetrics, [
      entry({ metricId: "met_kill", value: 100, recordedAt: sameTimestamp, createdAt: sameTimestamp, id: "aaa" }),
      entry({ metricId: "met_kill", value: 200, recordedAt: sameTimestamp, createdAt: sameTimestamp, id: "zzz" }),
    ]);

    // Higher id wins the tie (matches every writer's own tie-break, ADR-018 §4).
    expect(row.current?.value).toBe(200);
    expect(row.previous?.value).toBe(100);
  });

  // Voided-latest-entry ordering: this is the bug fix. A VOIDED row (null
  // value) that is the most recent event must NOT be skipped past in favor
  // of an older ACTIVE value - it must correctly suppress "current"
  // entirely, even though the UI can only show "not recorded" for it today
  // (see module doc comment for why a distinct "voided" UI state is out of
  // scope for this fix).
  it("EXPECTED_BREAKING vs. the pre-fix scan: a voided row as the most recent event correctly clears current (while still surfacing the prior value as previous), instead of falling back to the stale prior active value as current", () => {
    const [row] = buildCurrentMetricViewModels(periodMetrics, [
      entry({ metricId: "met_kill", value: 750000, recordedAt: new Date("2026-07-23T10:00:00Z"), id: "e_active" }),
      entry({ metricId: "met_kill", value: null, recordedAt: new Date("2026-07-24T10:00:00Z"), id: "e_voided" }),
    ]);

    // Old behavior (removed): filtering out the null value *before* picking
    // positions would have skipped straight to e_active and shown
    // current = 750000, previous = undefined - a stale, no-longer-current
    // number presented as if it were live, with no sign it had since been
    // voided.
    expect(row.current).toBeUndefined();
    // e_active (a real, non-null value) still correctly occupies "position
    // 1" - the void only ever displaces what counts as *current*, not what
    // history exists. "previous: 750000, current: not recorded" is the
    // honest state; "current: 750000" (the old bug) is not.
    expect(row.previous?.value).toBe(750000);
    expect(row.delta).toBeUndefined();
  });

  it("a voided row in the second-most-recent position (not the most recent) still lets the true most recent active value show as current, with no previous", () => {
    const [row] = buildCurrentMetricViewModels(periodMetrics, [
      entry({ metricId: "met_kill", value: null, recordedAt: new Date("2026-07-22T10:00:00Z"), id: "e_older_void" }),
      entry({ metricId: "met_kill", value: 1250000, recordedAt: new Date("2026-07-24T10:00:00Z"), id: "e_newest_active" }),
    ]);

    expect(row.current?.value).toBe(1250000);
    expect(row.previous).toBeUndefined();
    expect(row.delta).toBeUndefined();
  });

  it("handles multiple metrics independently, using each metric's own entries only", () => {
    const rows = buildCurrentMetricViewModels(
      [metricInput("met_kill", "Kill Points"), metricInput("met_vs", "VS Score")],
      [
        entry({ metricId: "met_kill", value: 1000, id: "e_kill" }),
        entry({ metricId: "met_vs", value: 2300, id: "e_vs" }),
      ],
    );

    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.metricId === "met_kill")?.current?.value).toBe(1000);
    expect(rows.find((r) => r.metricId === "met_vs")?.current?.value).toBe(2300);
  });

  it("preserves the input periodMetrics order and includes metrics with zero entries", () => {
    const rows = buildCurrentMetricViewModels(
      [metricInput("met_a", "A"), metricInput("met_b", "B")],
      [entry({ metricId: "met_b", value: 5, id: "e1" })],
    );

    expect(rows.map((r) => r.metricId)).toEqual(["met_a", "met_b"]);
    expect(rows[0].current).toBeUndefined();
    expect(rows[1].current?.value).toBe(5);
  });
});

// #321's locked scope: `new` = no prior period exists in the alliance's
// history at all (a period-level fact, applied uniformly); `no-baseline` =
// a prior period exists but this specific metric has no comparable value
// there, collapsing every sub-reason (not attached, member wasn't active,
// voided/absent) into one leader-facing state by design.
describe("buildPeriodTrendViewModels", () => {
  // NEUTRAL here (see metricInput's own comment) means every "comparable"
  // assertion in this top section expects favorability: "neutral" - the
  // dedicated "favorability" describe block below is what actually
  // exercises HIGHER_IS_BETTER/LOWER_IS_BETTER.
  const periodMetrics = [metricInput("met_kill", "Kill Points"), metricInput("met_vs", "VS Score")];

  function rollup(metricId: string, value: number | null): RollupMetricValue {
    return { metricId, value };
  }

  it("marks every metric 'new' when there is no prior period at all, regardless of current-period data", () => {
    const trends = buildPeriodTrendViewModels(
      periodMetrics,
      [rollup("met_kill", 900), rollup("met_vs", 2300)],
      null,
    );

    expect(trends.get("met_kill")).toEqual({ status: "new" });
    expect(trends.get("met_vs")).toEqual({ status: "new" });
  });

  it("reports 'comparable' with an 'up' direction when the current value exceeds the prior period's", () => {
    const trends = buildPeriodTrendViewModels(
      periodMetrics,
      [rollup("met_kill", 900), rollup("met_vs", 100)],
      [rollup("met_kill", 850), rollup("met_vs", 100)],
    );

    expect(trends.get("met_kill")).toEqual({
      status: "comparable",
      currentValue: 900,
      previousValue: 850,
      delta: 50,
      direction: "up",
      favorability: "neutral",
    });
  });

  it("reports 'down' when the current value is lower than the prior period's", () => {
    const trends = buildPeriodTrendViewModels(
      periodMetrics,
      [rollup("met_kill", 800)],
      [rollup("met_kill", 900)],
    );

    expect(trends.get("met_kill")).toEqual({
      status: "comparable",
      currentValue: 800,
      previousValue: 900,
      delta: -100,
      direction: "down",
      favorability: "neutral",
    });
  });

  it("reports 'flat' when the current value exactly equals the prior period's", () => {
    const trends = buildPeriodTrendViewModels(
      periodMetrics,
      [rollup("met_kill", 900)],
      [rollup("met_kill", 900)],
    );

    expect(trends.get("met_kill")).toEqual({
      status: "comparable",
      currentValue: 900,
      previousValue: 900,
      delta: 0,
      direction: "flat",
      favorability: "neutral",
    });
  });

  it("reports 'no-baseline' when the prior period exists but this metric has no value there (not attached, inactive membership, or voided)", () => {
    const trends = buildPeriodTrendViewModels(
      periodMetrics,
      [rollup("met_kill", 900)],
      [rollup("met_kill", null)],
    );

    expect(trends.get("met_kill")).toEqual({ status: "no-baseline" });
  });

  it("reports 'no-baseline' (not 'comparable') when the current period's rollup value is itself null", () => {
    const trends = buildPeriodTrendViewModels(
      periodMetrics,
      [rollup("met_kill", null)],
      [rollup("met_kill", 900)],
    );

    expect(trends.get("met_kill")).toEqual({ status: "no-baseline" });
  });

  it("treats a metric missing entirely from either period's rollup array the same as an explicit null value", () => {
    const trends = buildPeriodTrendViewModels(periodMetrics, [], [rollup("met_kill", 900)]);

    expect(trends.get("met_kill")).toEqual({ status: "no-baseline" });
    expect(trends.get("met_vs")).toEqual({ status: "no-baseline" });
  });

  it("resolves each metric independently within the same call", () => {
    const trends = buildPeriodTrendViewModels(
      periodMetrics,
      [rollup("met_kill", 900), rollup("met_vs", 50)],
      [rollup("met_kill", 850), rollup("met_vs", null)],
    );

    expect(trends.get("met_kill")).toMatchObject({ status: "comparable", direction: "up" });
    expect(trends.get("met_vs")).toEqual({ status: "no-baseline" });
  });
});

// #323: whether a `comparable` trend's `direction` is good or bad news is a
// leadership judgment the metric's own `trendDirection` config already
// encodes (`metricTrendDirection.ts`) - not something inferable from
// `direction` alone. A naive "up is always green" would be actively
// misleading for a LOWER_IS_BETTER metric (e.g. infractions).
describe("buildPeriodTrendViewModels favorability (#323)", () => {
  function rollup(metricId: string, value: number | null): RollupMetricValue {
    return { metricId, value };
  }

  it("HIGHER_IS_BETTER: an increase is favorable, a decrease is adverse", () => {
    const metrics = [metricInput("met_kill", "Kill Points", MetricTrendDirection.HIGHER_IS_BETTER)];

    const up = buildPeriodTrendViewModels(metrics, [rollup("met_kill", 900)], [rollup("met_kill", 850)]);
    expect(up.get("met_kill")).toMatchObject({ direction: "up", favorability: "favorable" });

    const down = buildPeriodTrendViewModels(metrics, [rollup("met_kill", 800)], [rollup("met_kill", 900)]);
    expect(down.get("met_kill")).toMatchObject({ direction: "down", favorability: "adverse" });
  });

  it("LOWER_IS_BETTER: an increase is adverse, a decrease is favorable (the inverse of HIGHER_IS_BETTER)", () => {
    const metrics = [metricInput("met_infractions", "Infractions", MetricTrendDirection.LOWER_IS_BETTER)];

    const up = buildPeriodTrendViewModels(metrics, [rollup("met_infractions", 5)], [rollup("met_infractions", 2)]);
    expect(up.get("met_infractions")).toMatchObject({ direction: "up", favorability: "adverse" });

    const down = buildPeriodTrendViewModels(metrics, [rollup("met_infractions", 1)], [rollup("met_infractions", 5)]);
    expect(down.get("met_infractions")).toMatchObject({ direction: "down", favorability: "favorable" });
  });

  it("NEUTRAL: never favorable or adverse regardless of direction - always neutral", () => {
    const metrics = [metricInput("met_misc", "Misc", MetricTrendDirection.NEUTRAL)];

    const up = buildPeriodTrendViewModels(metrics, [rollup("met_misc", 900)], [rollup("met_misc", 850)]);
    expect(up.get("met_misc")).toMatchObject({ direction: "up", favorability: "neutral" });

    const down = buildPeriodTrendViewModels(metrics, [rollup("met_misc", 800)], [rollup("met_misc", 900)]);
    expect(down.get("met_misc")).toMatchObject({ direction: "down", favorability: "neutral" });
  });

  it("a zero-change (flat) trend is always neutral, even for a HIGHER_IS_BETTER/LOWER_IS_BETTER metric", () => {
    const higherIsBetter = [metricInput("met_kill", "Kill Points", MetricTrendDirection.HIGHER_IS_BETTER)];
    const lowerIsBetter = [metricInput("met_infractions", "Infractions", MetricTrendDirection.LOWER_IS_BETTER)];

    const flatHigher = buildPeriodTrendViewModels(higherIsBetter, [rollup("met_kill", 900)], [rollup("met_kill", 900)]);
    expect(flatHigher.get("met_kill")).toMatchObject({ direction: "flat", favorability: "neutral" });

    const flatLower = buildPeriodTrendViewModels(lowerIsBetter, [rollup("met_infractions", 3)], [rollup("met_infractions", 3)]);
    expect(flatLower.get("met_infractions")).toMatchObject({ direction: "flat", favorability: "neutral" });
  });
});
