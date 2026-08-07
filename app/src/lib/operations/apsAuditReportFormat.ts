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
 * Within that second category, counts that are exact breakdowns of (or
 * otherwise exactly derivable from) each other are coarsened as a single
 * BUNDLE (`coarsenCorrelatedCounts`), not independently
 * (`coarsenSmallCount`): independently coarsening only the small members of
 * a closed-sum group while leaving the total and other categories exact
 * would let a reader recover the coarsened value(s) by subtraction. Genuine
 * standalone counts (e.g. total period count, comparable-pair count) use
 * `coarsenSmallCount` directly since nothing else in the report sums to
 * them.
 */
import { coarsenCorrelatedCounts, coarsenSmallCount, formatSuppressibleStatistic } from "./apsAuditPrivacy";
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
  // `periodsWithBothDatesCount` is an exact breakdown of `durationBucketCounts`
  // (every dated period falls into exactly one bucket) -- bundled together
  // so a small bucket can't be recovered by subtracting the other
  // (otherwise-exact) buckets from an otherwise-exact total.
  const durations = stats.durationBucketCounts;
  const bundle = coarsenCorrelatedCounts({
    periodsWithBothDates: stats.periodsWithBothDatesCount,
    lte7: durations.LTE_7_DAYS,
    d8to14: durations.D8_TO_14_DAYS,
    d15to31: durations.D15_TO_31_DAYS,
    d32plus: durations.D32_PLUS_DAYS,
  });

  return [
    // Standalone: nothing else in the report sums to periodCount (it
    // includes undated periods, which have no other breakdown at all).
    `- Total periods: ${coarsenSmallCount(stats.periodCount)}`,
    `- Periods with both start and end dates: ${bundle.periodsWithBothDates}`,
    // Standalone: comparablePairCount is a count of PAIRS, not a breakdown
    // that sums to any other shown total.
    `- Comparable period pairs (equal duration, non-overlapping): ${coarsenSmallCount(stats.comparablePairCount)}`,
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
