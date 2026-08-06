/**
 * Formats an `ApsDataReadinessAuditReport` (#284 PR A) into the sanitized
 * plain-text report the CLI prints as its *only* output. Every value that
 * reaches this formatter has already been pseudonymized and small-cell
 * suppressed by `apsDataReadinessAudit.ts` — this module does not re-derive
 * or re-check that; it only renders what it's given.
 */
import { formatSuppressibleStatistic } from "./apsAuditPrivacy";
import type { ApsDataReadinessAuditReport, AllianceAuditSection } from "./apsDataReadinessAudit";
import type { NumericDistribution } from "./apsAuditDistribution";

function formatDistribution(distribution: NumericDistribution): string {
  return (
    `count=${distribution.count} min=${distribution.min} max=${distribution.max} ` +
    `p25=${distribution.p25.toFixed(2)} p50=${distribution.p50.toFixed(2)} p75=${distribution.p75.toFixed(2)} ` +
    `zeros=${distribution.zeroCount} negatives=${distribution.negativeCount} outliers=${distribution.outlierCount}`
  );
}

function formatAllianceSection(section: AllianceAuditSection): string[] {
  const lines: string[] = [];
  lines.push(`## ${section.label}`);

  lines.push("");
  lines.push("### Comparable evaluation periods");
  lines.push(`- Total periods: ${section.comparablePeriods.periodCount}`);
  lines.push(`- Periods with both start and end dates: ${section.comparablePeriods.periodsWithBothDatesCount}`);
  lines.push(`- Comparable period pairs (equal duration, non-overlapping): ${section.comparablePeriods.comparablePairCount}`);

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
      lines.push(
        `- ${row.metricLabel} [${row.summaryKind}/${row.trendDirection}]: ` +
          `active ${row.recordedActiveMemberCount}/${row.currentActiveMemberCount} recorded, ` +
          `${row.invalidActiveMemberCount} invalid, ${row.missingActiveMemberCount} missing, ` +
          `${row.archivedContributingMemberCount} archived contributors`,
      );
      if (row.section.kind === "BOOLEAN") {
        lines.push(`    true=${row.section.trueCount} false=${row.section.falseCount} invalid=${row.section.invalidCount}`);
      } else {
        lines.push(`    ${formatSuppressibleStatistic(row.section.distribution, formatDistribution)}`);
      }
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
    `- ${dogfood.metricsWithEnoughObservationsCount} of ${dogfood.totalMetricCount} metrics attached to at least ` +
      `${dogfood.minPeriodsForDogfood} periods.`,
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
