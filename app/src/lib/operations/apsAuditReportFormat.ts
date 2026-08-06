/**
 * Formats an `ApsDataReadinessAuditReport` (#284 PR A) into the sanitized
 * plain-text report the CLI prints as its *only* output. Every value that
 * reaches this formatter has already been pseudonymized and small-cell
 * suppressed by `apsDataReadinessAudit.ts` — this module does not re-derive
 * or re-check that; it only renders what it's given, and never disclosed
 * the exact suppressed cell size for anything it renders via
 * `formatSuppressibleStatistic`.
 */
import { formatSuppressibleStatistic } from "./apsAuditPrivacy";
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

function formatAllianceSection(section: AllianceAuditSection): string[] {
  const lines: string[] = [];
  lines.push(`## ${section.label}`);

  lines.push("");
  lines.push("### Comparable evaluation periods");
  lines.push(`- Total periods: ${section.comparablePeriods.periodCount}`);
  lines.push(`- Periods with both start and end dates: ${section.comparablePeriods.periodsWithBothDatesCount}`);
  lines.push(`- Comparable period pairs (equal duration, non-overlapping): ${section.comparablePeriods.comparablePairCount}`);
  const durations = section.comparablePeriods.durationBucketCounts;
  lines.push(
    `- Period duration buckets: <=7d: ${durations.LTE_7_DAYS}, 8-14d: ${durations.D8_TO_14_DAYS}, ` +
      `15-31d: ${durations.D15_TO_31_DAYS}, 32d+: ${durations.D32_PLUS_DAYS}`,
  );

  lines.push("");
  lines.push("### Configured metrics");
  const config = section.metricConfiguration;
  lines.push(`- Total metrics: ${config.totalMetricCount} (active: ${config.activeMetricCount}, archived: ${config.archivedMetricCount})`);
  lines.push(`- By type: ${JSON.stringify(config.byType)}`);
  lines.push(`- By summary kind: ${JSON.stringify(config.bySummaryKind)}`);
  lines.push(`- By trend direction: ${JSON.stringify(config.byTrendDirection)}`);
  lines.push(`- Attachments across all periods — active: ${config.activeAttachmentCount}, inactive: ${config.inactiveAttachmentCount}`);

  lines.push("");
  lines.push("### Current period weights");
  if (!section.currentPeriodWeights.currentPeriodFound) {
    lines.push("- No active period found for this alliance.");
  } else {
    const weights = section.currentPeriodWeights;
    lines.push(`- Active components: ${weights.activeComponentCount}`);
    lines.push(`- Zero-weight components: ${weights.zeroWeightComponentCount}`);
    lines.push(`- Required components: ${weights.requiredComponentCount}`);
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
  lines.push(`- Consecutive dated-period pairs: ${stability.consecutivePeriodPairCount}`);
  lines.push(`- Metrics added: ${stability.metricsAddedCount}`);
  lines.push(`- Metrics removed: ${stability.metricsRemovedCount}`);
  lines.push(`- Weights changed: ${stability.weightChangedCount}`);

  lines.push("");
  lines.push("### Dogfood readiness");
  const dogfood = section.dogfoodReadiness;
  lines.push(
    `- ${dogfood.metricsWithEnoughObservationsCount} of ${dogfood.totalMetricCount} metrics have at least one ` +
      `valid recorded value in at least ${dogfood.minPeriodsForDogfood} distinct periods.`,
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
