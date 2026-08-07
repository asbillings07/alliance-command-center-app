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
 * would let a reader recover the coarsened value(s) by subtraction.
 *
 * Bundling is deliberately based on REAL domain relationships, not mere
 * numeric proximity: two counts that merely happen to be close together
 * (e.g. active/inactive attachment counts, or metrics-added/-removed
 * across periods -- independent tallies in unrelated units) leak nothing
 * by both being shown exactly, and flagging them as "suppressed" would
 * both erase valid audit evidence and mislabel the reason. When a bundle's
 * displayed keys are a full, exhaustive decomposition of a total (every
 * category covers every case, e.g. `byType` or `active + archived`),
 * checking each displayed value alone is already sufficient -- there is no
 * hidden remainder. Only when the bundle's total has an UNSHOWN subset
 * (e.g. `total` vs. `enough`, where "not enough" is never itself a
 * printed field) does that implicit complement need to be computed and
 * passed via `additionalRiskValues` so it participates in the risk check
 * without being rendered. Genuine standalone counts (no total/subset
 * relationship to anything else shown, e.g. comparable-pair counts,
 * metrics added/removed/weight-changed) are coarsened independently with
 * `coarsenSmallCount`.
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
  // `periodCount` is the TOTAL; `periodsWithBothDatesCount` is a SHOWN
  // SUBSET of it -- "undated periods" (periodCount - periodsWithBothDates)
  // is a real, exactly-derivable complement that is never itself a printed
  // field, so it's computed here and passed as an `additionalRiskValues`
  // check rather than rendered. The four duration buckets, in turn, are a
  // FULL decomposition of `periodsWithBothDatesCount` (every dated period
  // falls into exactly one bucket) -- no separate complement needed there,
  // but they must share this bundle so a hidden `periodsWithBothDatesCount`
  // can't be recovered by summing otherwise-exact buckets.
  const durations = stats.durationBucketCounts;
  const undatedPeriodCount = stats.periodCount - stats.periodsWithBothDatesCount;
  const bundle = coarsenCorrelatedCounts(
    {
      periodCount: stats.periodCount,
      periodsWithBothDates: stats.periodsWithBothDatesCount,
      lte7: durations.LTE_7_DAYS,
      d8to14: durations.D8_TO_14_DAYS,
      d15to31: durations.D15_TO_31_DAYS,
      d32plus: durations.D32_PLUS_DAYS,
    },
    { additionalRiskValues: [undatedPeriodCount] },
  );

  return [
    `- Total periods: ${bundle.periodCount}`,
    `- Periods with both start and end dates: ${bundle.periodsWithBothDates}`,
    // Standalone: a count of PAIRS in a different unit than the period
    // counts above, with no total/subset relationship to any of them.
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

  // `active` is the TOTAL; `zeroWeight` and `required` are each SHOWN
  // SUBSETS of it (a component can be zero-weight, required, both, or
  // neither -- they are not a partition of each other). Their own implicit
  // complements against the total ("non-zero-weight", "not required") are
  // never printed fields, so both are computed and checked here.
  // `zeroWeight` and `required` are not compared against EACH OTHER --
  // they can legitimately overlap, so their numeric closeness (if any)
  // reflects no real relationship and must not trigger suppression.
  const notZeroWeight = weights.activeComponentCount - weights.zeroWeightComponentCount;
  const notRequired = weights.activeComponentCount - weights.requiredComponentCount;
  const bundle = coarsenCorrelatedCounts(
    {
      active: weights.activeComponentCount,
      zeroWeight: weights.zeroWeightComponentCount,
      required: weights.requiredComponentCount,
    },
    { additionalRiskValues: [notZeroWeight, notRequired] },
  );

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
  // Each of these is an independent tally with no total/subset
  // relationship to the others: `consecutivePeriodPairCount` counts PERIOD
  // PAIRS examined, while added/removed/weight-changed count METRIC-level
  // events that can occur any number of times per pair (or not at all) --
  // there is no equation linking them, so each is coarsened standalone
  // rather than bundled. Bundling counts with no real relationship (as a
  // prior version of this function did) would suppress valid evidence
  // whenever two of them merely happened to be numerically close.
  return [
    `- Consecutive dated-period pairs: ${coarsenSmallCount(stability.consecutivePeriodPairCount)}`,
    `- Metrics added: ${coarsenSmallCount(stability.metricsAddedCount)}`,
    `- Metrics removed: ${coarsenSmallCount(stability.metricsRemovedCount)}`,
    `- Weights changed: ${coarsenSmallCount(stability.weightChangedCount)}`,
  ];
}

function formatDogfoodReadiness(dogfood: AllianceAuditSection["dogfoodReadiness"]): string[] {
  // `total` is the TOTAL; `enough` is a SHOWN SUBSET of it. "Not enough
  // observations" (total - enough) is a real, exactly-derivable complement
  // that is never itself a printed field, so it's computed and checked
  // here without being rendered.
  const notEnough = dogfood.totalMetricCount - dogfood.metricsWithEnoughObservationsCount;
  const bundle = coarsenCorrelatedCounts(
    {
      enough: dogfood.metricsWithEnoughObservationsCount,
      total: dogfood.totalMetricCount,
    },
    { additionalRiskValues: [notEnough] },
  );

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
