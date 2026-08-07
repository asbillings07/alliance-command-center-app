/**
 * Formats an `ApsDataReadinessAuditReport` (#284 PR A) into the sanitized
 * plain-text report the CLI prints as its *only* output.
 *
 * Two distinct privacy mechanisms meet here, for two distinct threats:
 *  - Member-derived statistics (coverage, archived contributions,
 *    distribution/boolean breakdowns) arrive from `apsDataReadinessAudit.ts`
 *    already small-cell SUPPRESSED (`formatSuppressibleStatistic`) --
 *    protecting individual members from being identified by a small cohort.
 *  - Alliance-configuration counts (periods, metric types/attachments,
 *    weight components, stability changes, dogfood readiness) are plain
 *    numbers from the report, which THIS module coarsens before printing --
 *    protecting the pseudonymous ALLIANCE's identity from a sparse
 *    configuration acting as a fingerprint. This is deliberately a
 *    coarsening, not a suppression of the underlying report object: the
 *    `ApsDataReadinessAuditReport` itself stays exact so a reviewer with
 *    legitimate access to it (before formatting) isn't blocked from
 *    reasoning about it -- only the printed CLI output is coarsened.
 *
 * Within that second category, every count in this module is coarsened as
 * part of a named BUNDLE (`coarsenCorrelatedCounts`), never independently:
 * `coarsenCorrelatedCounts` is equation-aware, checking not just each raw
 * value but every pairwise difference within the bundle too, so two
 * otherwise-safe values (e.g. `total=20`/`enough=19`) that are merely close
 * together can't disclose a small derived complement (`total - enough = 1`)
 * either. A count only gets its own single-member "bundle" when nothing
 * else in the report is close enough to it to matter -- but even then it
 * goes through the same function, so nothing in this module bypasses the
 * pairwise check by construction.
 */
import { coarsenCorrelatedCounts, formatSuppressibleStatistic } from "./apsAuditPrivacy";
import type { ApsDataReadinessAuditReport, AllianceAuditSection, MetricRowStats } from "./apsDataReadinessAudit";

function formatRowStats(stats: MetricRowStats): string {
  const { coverage } = stats;
  const lines = [
    `active ${coverage.recordedActiveMemberCount}/${coverage.currentActiveMemberCount} recorded, ` +
      `${coverage.invalidActiveMemberCount} invalid, ${coverage.missingActiveMemberCount} missing`,
    `archived contributors: ${stats.archivedContributingMemberCount}`,
  ];

  if (stats.section.kind === "BOOLEAN") {
    lines.push(`true=${stats.section.counts.trueCount} false=${stats.section.counts.falseCount}`);
  } else if (stats.section.distribution === null) {
    lines.push("no valid values recorded");
  } else {
    const d = stats.section.distribution;
    lines.push(
      `count=${d.count} min=${d.min} max=${d.max} p25=${d.p25.toFixed(2)} p50=${d.p50.toFixed(2)} p75=${d.p75.toFixed(2)} ` +
        `zeros=${d.zeroCount} negatives=${d.negativeCount} outliers=${d.outlierCount}`,
    );
  }

  return lines.join("\n    ");
}

function formatComparablePeriods(stats: AllianceAuditSection["comparablePeriods"]): string[] {
  // One bundle for the whole section, not a standalone `periodCount` next
  // to a separately-bundled duration breakdown: `periodCount` and
  // `periodsWithBothDatesCount` can each independently clear `minCellSize`
  // while their DIFFERENCE ("undated periods") is still small and exact
  // (e.g. 20 vs 19) -- a complement `coarsenCorrelatedCounts`'s
  // pairwise-difference check only catches if both values are in the same
  // bundle. `comparablePairCount` joins too, for the same defense-in-depth
  // reason (it has no known exact relationship to the others, but bundling
  // costs nothing and closes any relationship this doc comment missed).
  const durations = stats.durationBucketCounts;
  const bundle = coarsenCorrelatedCounts({
    periodCount: stats.periodCount,
    periodsWithBothDates: stats.periodsWithBothDatesCount,
    comparablePairs: stats.comparablePairCount,
    lte7: durations.LTE_7_DAYS,
    d8to14: durations.D8_TO_14_DAYS,
    d15to31: durations.D15_TO_31_DAYS,
    d32plus: durations.D32_PLUS_DAYS,
  });

  return [
    `- Total periods: ${bundle.periodCount}`,
    `- Periods with both start and end dates: ${bundle.periodsWithBothDates}`,
    `- Comparable period pairs (equal duration, non-overlapping): ${bundle.comparablePairs}`,
    `- Period duration buckets: <=7d: ${bundle.lte7}, 8-14d: ${bundle.d8to14}, 15-31d: ${bundle.d15to31}, 32d+: ${bundle.d32plus}`,
  ];
}

function formatMetricConfiguration(config: AllianceAuditSection["metricConfiguration"]): string[] {
  // totalMetricCount = activeMetricCount + archivedMetricCount, and each of
  // byType/bySummaryKind/byTrendDirection independently sums to
  // totalMetricCount too -- all bundled together as one closed-sum group.
  const compositionBundle = coarsenCorrelatedCounts({
    total: config.totalMetricCount,
    active: config.activeMetricCount,
    archived: config.archivedMetricCount,
    ...prefixedEntries("type", config.byType),
    ...prefixedEntries("summary", config.bySummaryKind),
    ...prefixedEntries("trend", config.byTrendDirection),
  });

  // active + inactive attachments is its own, separate closed-sum pair --
  // not part of the metric-composition total above.
  const attachmentBundle = coarsenCorrelatedCounts({
    active: config.activeAttachmentCount,
    inactive: config.inactiveAttachmentCount,
  });

  return [
    `- Total metrics: ${compositionBundle.total} (active: ${compositionBundle.active}, archived: ${compositionBundle.archived})`,
    `- By type: ${renderPrefixedBundle("type", config.byType, compositionBundle)}`,
    `- By summary kind: ${renderPrefixedBundle("summary", config.bySummaryKind, compositionBundle)}`,
    `- By trend direction: ${renderPrefixedBundle("trend", config.byTrendDirection, compositionBundle)}`,
    `- Attachments across all periods — active: ${attachmentBundle.active}, inactive: ${attachmentBundle.inactive}`,
  ];
}

/** Prefixes each record key so it can be merged into a larger bundle without key collisions across records. */
function prefixedEntries<T extends string>(prefix: string, record: Record<T, number>): Record<string, number> {
  return Object.fromEntries(Object.entries<number>(record).map(([key, value]) => [`${prefix}:${key}`, value]));
}

function renderPrefixedBundle<T extends string>(
  prefix: string,
  record: Record<T, number>,
  bundle: Record<string, string>,
): string {
  return Object.keys(record)
    .map((key) => `${key}: ${bundle[`${prefix}:${key}`]}`)
    .join(", ");
}

function formatCurrentPeriodWeights(weights: AllianceAuditSection["currentPeriodWeights"]): string[] {
  if (!weights.currentPeriodFound) {
    return ["- No active period found for this alliance."];
  }

  // Not a strict closed sum (a component can be both zero-weight and
  // required, or neither), but bundled anyway for defense in depth given
  // how tightly these three describe the same small configuration surface.
  const bundle = coarsenCorrelatedCounts({
    active: weights.activeComponentCount,
    zeroWeight: weights.zeroWeightComponentCount,
    required: weights.requiredComponentCount,
  });

  return [
    `- Active components: ${bundle.active}`,
    `- Zero-weight components: ${bundle.zeroWeight}`,
    `- Required components: ${bundle.required}`,
    // Not coarsened: a configuration VALUE (leader-chosen weights summed),
    // not a count of things, so there's no small "cohort" being disclosed.
    `- Weight sum: ${weights.weightSum}`,
  ];
}

function formatMetricStability(stability: AllianceAuditSection["metricStability"]): string[] {
  const bundle = coarsenCorrelatedCounts({
    pairs: stability.consecutivePeriodPairCount,
    added: stability.metricsAddedCount,
    removed: stability.metricsRemovedCount,
    weightChanged: stability.weightChangedCount,
  });

  return [
    `- Consecutive dated-period pairs: ${bundle.pairs}`,
    `- Metrics added: ${bundle.added}`,
    `- Metrics removed: ${bundle.removed}`,
    `- Weights changed: ${bundle.weightChanged}`,
  ];
}

function formatDogfoodReadiness(dogfood: AllianceAuditSection["dogfoodReadiness"]): string[] {
  // metricsWithEnoughObservationsCount and totalMetricCount are bundled
  // together: "not enough observations" (totalMetricCount minus the
  // former) is an exactly-derivable complement, so both must be hidden
  // together once either is small.
  const bundle = coarsenCorrelatedCounts({
    enough: dogfood.metricsWithEnoughObservationsCount,
    total: dogfood.totalMetricCount,
  });

  return [
    `- ${bundle.enough} of ${bundle.total} metrics have at least one valid recorded value in at least ` +
      `${dogfood.minPeriodsForDogfood} distinct periods.`,
  ];
}

function formatAllianceSection(section: AllianceAuditSection): string[] {
  const lines: string[] = [];
  lines.push(`## ${section.label}`);

  lines.push("");
  lines.push("### Comparable evaluation periods");
  lines.push(...formatComparablePeriods(section.comparablePeriods));

  lines.push("");
  lines.push("### Configured metrics");
  lines.push(...formatMetricConfiguration(section.metricConfiguration));

  lines.push("");
  lines.push("### Current period weights");
  lines.push(...formatCurrentPeriodWeights(section.currentPeriodWeights));

  lines.push("");
  lines.push("### Per-metric coverage and distribution (current period)");
  if (section.metricDistributions.length === 0) {
    lines.push("- No actively attached metrics with data for the current period.");
  } else {
    for (const row of section.metricDistributions) {
      lines.push(`- ${row.metricLabel} [${row.summaryKind}/${row.trendDirection}]:`);
      lines.push(`    ${formatSuppressibleStatistic(row.stats, formatRowStats)}`);
    }
  }

  lines.push("");
  lines.push("### Configuration stability across consecutive dated periods");
  lines.push(...formatMetricStability(section.metricStability));

  lines.push("");
  lines.push("### Dogfood readiness");
  lines.push(...formatDogfoodReadiness(section.dogfoodReadiness));

  lines.push("");
  return lines;
}

export function formatApsDataReadinessAuditReport(report: ApsDataReadinessAuditReport): string {
  const lines: string[] = [
    "APS data-readiness audit report (bounded Founder Beta sample)",
    `Generated at: ${report.generatedAt}`,
    `Alliances audited: ${report.allianceCount}`,
    `Small-cell suppression threshold: ${report.minCellSize}`,
    "",
    "Limitations:",
    ...report.limitations.map((limitation) => `- ${limitation}`),
    "",
  ];

  for (const section of report.alliances) {
    lines.push(...formatAllianceSection(section));
  }

  return lines.join("\n");
}
