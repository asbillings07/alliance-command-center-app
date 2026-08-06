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
 *    numbers from the report, which THIS module coarsens
 *    (`coarsenSmallCount`) before printing -- protecting the pseudonymous
 *    ALLIANCE's identity from a sparse configuration acting as a
 *    fingerprint. This is deliberately a coarsening, not a suppression: the
 *    underlying `ApsDataReadinessAuditReport` object stays exact so a
 *    reviewer with legitimate access to it (before formatting) isn't
 *    blocked from reasoning about it -- only the printed CLI output is
 *    coarsened.
 */
import { coarsenSmallCount, formatSuppressibleStatistic } from "./apsAuditPrivacy";
import type { ApsDataReadinessAuditReport, AllianceAuditSection, MetricRowStats } from "./apsDataReadinessAudit";

function formatCoarseRecord<T extends string>(record: Record<T, number>): string {
  return Object.entries<number>(record)
    .map(([key, value]) => `${key}: ${coarsenSmallCount(value)}`)
    .join(", ");
}

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

function formatAllianceSection(section: AllianceAuditSection): string[] {
  const lines: string[] = [];
  lines.push(`## ${section.label}`);

  lines.push("");
  lines.push("### Comparable evaluation periods");
  lines.push(`- Total periods: ${coarsenSmallCount(section.comparablePeriods.periodCount)}`);
  lines.push(`- Periods with both start and end dates: ${coarsenSmallCount(section.comparablePeriods.periodsWithBothDatesCount)}`);
  lines.push(
    `- Comparable period pairs (equal duration, non-overlapping): ${coarsenSmallCount(section.comparablePeriods.comparablePairCount)}`,
  );
  const durations = section.comparablePeriods.durationBucketCounts;
  lines.push(
    `- Period duration buckets: <=7d: ${coarsenSmallCount(durations.LTE_7_DAYS)}, 8-14d: ${coarsenSmallCount(durations.D8_TO_14_DAYS)}, ` +
      `15-31d: ${coarsenSmallCount(durations.D15_TO_31_DAYS)}, 32d+: ${coarsenSmallCount(durations.D32_PLUS_DAYS)}`,
  );

  lines.push("");
  lines.push("### Configured metrics");
  const config = section.metricConfiguration;
  lines.push(
    `- Total metrics: ${coarsenSmallCount(config.totalMetricCount)} (active: ${coarsenSmallCount(config.activeMetricCount)}, ` +
      `archived: ${coarsenSmallCount(config.archivedMetricCount)})`,
  );
  lines.push(`- By type: ${formatCoarseRecord(config.byType)}`);
  lines.push(`- By summary kind: ${formatCoarseRecord(config.bySummaryKind)}`);
  lines.push(`- By trend direction: ${formatCoarseRecord(config.byTrendDirection)}`);
  lines.push(
    `- Attachments across all periods — active: ${coarsenSmallCount(config.activeAttachmentCount)}, ` +
      `inactive: ${coarsenSmallCount(config.inactiveAttachmentCount)}`,
  );

  lines.push("");
  lines.push("### Current period weights");
  if (!section.currentPeriodWeights.currentPeriodFound) {
    lines.push("- No active period found for this alliance.");
  } else {
    const weights = section.currentPeriodWeights;
    lines.push(`- Active components: ${coarsenSmallCount(weights.activeComponentCount)}`);
    lines.push(`- Zero-weight components: ${coarsenSmallCount(weights.zeroWeightComponentCount)}`);
    lines.push(`- Required components: ${coarsenSmallCount(weights.requiredComponentCount)}`);
    // Not coarsened: a configuration VALUE (leader-chosen weights summed),
    // not a count of things, so there's no small "cohort" being disclosed.
    lines.push(`- Weight sum: ${weights.weightSum}`);
  }

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
  const stability = section.metricStability;
  lines.push(`- Consecutive dated-period pairs: ${coarsenSmallCount(stability.consecutivePeriodPairCount)}`);
  lines.push(`- Metrics added: ${coarsenSmallCount(stability.metricsAddedCount)}`);
  lines.push(`- Metrics removed: ${coarsenSmallCount(stability.metricsRemovedCount)}`);
  lines.push(`- Weights changed: ${coarsenSmallCount(stability.weightChangedCount)}`);

  lines.push("");
  lines.push("### Dogfood readiness");
  const dogfood = section.dogfoodReadiness;
  lines.push(
    `- ${coarsenSmallCount(dogfood.metricsWithEnoughObservationsCount)} of ${coarsenSmallCount(dogfood.totalMetricCount)} metrics have ` +
      `at least one valid recorded value in at least ${dogfood.minPeriodsForDogfood} distinct periods.`,
  );

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
