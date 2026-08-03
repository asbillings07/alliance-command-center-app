import { MetricSummaryKind, MetricTrendDirection, Metric_Type } from "@/app/generated/prisma/enums";
import { isAdverseComparisonChange } from "@/app/src/lib/metrics/metricTrendDirection";
import { formatMetricAverage } from "@/app/src/lib/format/formatMetricAverage";
import { formatMetricValue } from "@/app/src/lib/format/formatMetricValue";
import { formatPercent } from "@/app/src/lib/format/formatPercent";
import type { MetricCoverage, MetricRollup } from "@/app/src/lib/reports/metricRollup";
import type { DistributionBin, MetricVisualModel } from "@/app/src/lib/reports/metricVisualModel";
import type {
  MetricPeriodAttachmentStatus,
  MetricPeriodDataStatus,
  MetricSummaryComparison,
} from "@/app/src/lib/reports/getMetricSummaryReport";

/**
 * The "what this tells you" one-sentence executive takeaway for a metric's
 * drill-down page (#264 PR4). Deliberately not server-only (type-only
 * imports from `getMetricSummaryReport.ts` are erased, never bundled) so
 * it stays reusable the same way `metricVisualModel.ts` is.
 *
 * Exactly one sentence built from up to two facts:
 *   - fact1 is always the kind's baseline reading of the data (or, for
 *     SUM, a substituted caveat when a bare total would be misleading).
 *   - fact2 is the single highest-priority applicable fact from, in order:
 *     coverage issue (invalid/missing) -> comparison change -> a
 *     kind-specific distribution/concentration note. Only one of these
 *     ever appears — never more — to keep this a takeaway, not a recap of
 *     the whole drill-down (which already has its own coverage card,
 *     comparison control, and chart).
 *
 * This never repeats language the deterministic alliance findings engine
 * (`allianceFindings.ts`) already owns (e.g. "attach it or archive it") —
 * that's an action-oriented alert; this is a read of what the chart shows.
 */
export function buildMetricInterpretationSummary(params: {
  metricName: string;
  unitLabel: string | null;
  summaryKind: MetricSummaryKind;
  metricType: Metric_Type;
  trendDirection: MetricTrendDirection;
  attachmentStatus: MetricPeriodAttachmentStatus;
  dataStatus: MetricPeriodDataStatus;
  rollup: MetricRollup;
  coverage: MetricCoverage;
  comparison: MetricSummaryComparison | null;
  visualModel: MetricVisualModel;
}): string {
  const {
    metricName,
    unitLabel,
    summaryKind,
    metricType,
    trendDirection,
    attachmentStatus,
    dataStatus,
    rollup,
    coverage,
    comparison,
    visualModel,
  } = params;

  // Priority 1: unavailable state — short-circuits, no second fact.
  if (attachmentStatus === "NOT_ATTACHED") {
    return `${metricName} isn't attached to this period, so there's no data to interpret yet.`;
  }
  if (attachmentStatus === "INACTIVE") {
    return `The attachment for ${metricName} is inactive this period, so there's no data to interpret.`;
  }
  if (dataStatus === "NO_VALUES") {
    return `${metricName} has no recorded results yet this period.`;
  }

  const { fact1, distributionFact } = buildBaselineFacts({ metricName, unitLabel, summaryKind, metricType, rollup, visualModel });

  // Priority 2: coverage issue. Priority 3: comparison change. Priority 4:
  // distribution/concentration. At most one wins the second-fact slot.
  const fact2 =
    buildCoverageFact(coverage) ??
    buildComparisonFact(summaryKind, trendDirection, comparison) ??
    distributionFact;

  return fact2 ? `${fact1} ${fact2}` : fact1;
}

function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural;
}

/** Priority 2 candidate: invalid/missing coverage against the active roster. Null when coverage is complete. */
function buildCoverageFact(coverage: MetricCoverage): string | null {
  const { missingActiveMemberCount: missing, invalidActiveMemberCount: invalid } = coverage;
  if (missing === 0 && invalid === 0) return null;

  if (missing > 0 && invalid > 0) {
    return `${missing} ${pluralize(missing, "member is", "members are")} missing and ${invalid} ${pluralize(
      invalid,
      "value is",
      "values are",
    )} invalid.`;
  }
  if (missing > 0) {
    return `${missing} active ${pluralize(missing, "member has", "members have")} no recorded response.`;
  }
  return `${invalid} ${pluralize(invalid, "value is", "values are")} invalid.`;
}

/**
 * Priority 3 candidate: a measured period-over-period change. Null when no
 * comparison was selected, the comparison couldn't be measured (no eligible
 * period, invalid selection, no data in either period), or the change
 * itself is meaningless (`absoluteChange === null`, e.g. every comparison
 * entry was a legacy invalid boolean value). Deliberately *not* one of
 * these unavailable comparison states — this sentence's job is to describe
 * this period's data, not to duplicate `MetricComparisonControl`'s own
 * "why can't I compare" messaging.
 */
function buildComparisonFact(
  summaryKind: MetricSummaryKind,
  trendDirection: MetricTrendDirection,
  comparison: MetricSummaryComparison | null,
): string | null {
  if (!comparison || comparison.status !== "COMPARED") return null;
  const { absoluteChange, percentageChange, period } = comparison;
  if (absoluteChange === null) return null;

  if (absoluteChange === 0) {
    return `It was unchanged since ${period.name}.`;
  }

  const verb = pickChangeVerb(trendDirection, absoluteChange);

  if (summaryKind === MetricSummaryKind.TRUE_RATE) {
    return `The rate ${verb} by ${formatPercent(Math.abs(absoluteChange), { unit: "pp" })} since ${period.name}.`;
  }
  if (percentageChange !== null) {
    return `It ${verb} by ${formatPercent(Math.abs(percentageChange))} since ${period.name}.`;
  }
  return `It ${verb} since ${period.name}.`;
}

/**
 * Neutral by default ("increased"/"decreased"), matching #264 PR1's
 * guardrail. Only substitutes judgment language ("improved"/"declined")
 * when the metric's own explicitly-configured `trendDirection` licenses
 * it — never inferred from the metric's kind or name.
 */
function pickChangeVerb(trendDirection: MetricTrendDirection, absoluteChange: number): string {
  const neutralVerb = absoluteChange > 0 ? "increased" : "decreased";
  if (trendDirection === MetricTrendDirection.NEUTRAL) return neutralVerb;
  return isAdverseComparisonChange(trendDirection, absoluteChange) ? "declined" : "improved";
}

function formatBoundary(value: number, unitLabel: string | null): string {
  return formatMetricAverage(value, unitLabel);
}

/** The bin with the most members, breaking ties by the lower (first-reached) range — fully deterministic given `bins`' fixed left-to-right order. */
function pickModalBin(bins: DistributionBin[]): DistributionBin {
  return bins.reduce((best, bin) => (bin.count > best.count ? bin : best));
}

function buildYesNoFact(trueCount: number, validCount: number): string {
  if (validCount === 0) return "No valid Yes/No responses have been recorded this period.";
  return `${trueCount} of ${validCount} valid ${pluralize(validCount, "response was", "responses were")} Yes.`;
}

/**
 * fact1 (always shown) and the priority-4 distribution/concentration
 * candidate (only shown when nothing higher-priority wins fact2), computed
 * together per kind since they share the same underlying numbers.
 */
function buildBaselineFacts(params: {
  metricName: string;
  unitLabel: string | null;
  summaryKind: MetricSummaryKind;
  metricType: Metric_Type;
  rollup: MetricRollup;
  visualModel: MetricVisualModel;
}): { fact1: string; distributionFact: string | null } {
  const { metricName, unitLabel, summaryKind, metricType, rollup, visualModel } = params;

  switch (summaryKind) {
    case MetricSummaryKind.SUM: {
      if (rollup.kind !== "SUM" || visualModel.kind !== "SUM") {
        throw new Error("buildBaselineFacts: SUM summaryKind requires a SUM rollup and visual model");
      }
      // A caveat replaces the bare total whenever it would otherwise be
      // interpreted as a meaningful per-member share — mirrors
      // `computeShareAvailability`'s own unavailability reasons.
      if (rollup.hasNegativeValues) {
        return {
          fact1: "Positive and negative contributions offset each other, so member shares are not meaningful.",
          distributionFact: null,
        };
      }
      if (rollup.total <= 0) {
        return {
          fact1: `${metricName} had no positive contributions this period, so no member share is meaningful.`,
          distributionFact: null,
        };
      }

      const totalExact = formatMetricValue(rollup.total, null).exact;
      const totalText = unitLabel ? `${totalExact} ${unitLabel}` : totalExact;
      const fact1 = `${metricName} totaled ${totalText}.`;

      let distributionFact: string | null = null;
      if (visualModel.topContributors.length > 0 && visualModel.shareAvailability.available) {
        const topShare = visualModel.topContributors.reduce((sum, c) => sum + (c.percentageOfTotal ?? 0), 0);
        const count = visualModel.topContributors.length;
        distributionFact = `The top ${count} ${pluralize(count, "member", "members")} accounted for ${formatPercent(
          topShare,
        )} of the total.`;
      }
      return { fact1, distributionFact };
    }

    case MetricSummaryKind.AVERAGE: {
      if (rollup.kind !== "AVERAGE" || visualModel.kind !== "AVERAGE") {
        throw new Error("buildBaselineFacts: AVERAGE summaryKind requires an AVERAGE rollup and visual model");
      }
      if (rollup.average === null || visualModel.validCount === 0) {
        return { fact1: `${metricName} has no valid results this period.`, distributionFact: null };
      }

      const avgText = formatMetricAverage(rollup.average, unitLabel);
      const fact1 = `The average was ${avgText} across ${visualModel.validCount} valid ${pluralize(
        visualModel.validCount,
        "result",
        "results",
      )}.`;

      let distributionFact: string | null = null;
      if (visualModel.aboveAverageCount > 0 || visualModel.belowAverageCount > 0) {
        distributionFact = `${visualModel.aboveAverageCount} ${pluralize(
          visualModel.aboveAverageCount,
          "member is",
          "members are",
        )} above average and ${visualModel.belowAverageCount} below.`;
      }
      return { fact1, distributionFact };
    }

    case MetricSummaryKind.TRUE_RATE: {
      if (rollup.kind !== "TRUE_RATE") {
        throw new Error("buildBaselineFacts: TRUE_RATE summaryKind requires a TRUE_RATE rollup");
      }
      const validCount = rollup.trueCount + rollup.falseCount;
      // TRUE_RATE's baseline already *is* its distribution (the yes/no
      // split) — there's no separate concentration note to add as fact2.
      return { fact1: buildYesNoFact(rollup.trueCount, validCount), distributionFact: null };
    }

    case MetricSummaryKind.NONE:
    default: {
      // NONE never has a rollup to read a headline number from — the
      // member-level distribution itself is the only story, and this
      // disclaimer is the fixed fallback fact2 whenever nothing
      // higher-priority (coverage) claims that slot, so a NONE-kind
      // metric never silently reads as if it had an alliance rollup.
      const distributionFact = "No alliance-wide rollup is defined for this metric.";

      if (metricType === Metric_Type.BOOLEAN) {
        if (visualModel.kind !== "NONE" || visualModel.valueKind !== "BOOLEAN") {
          throw new Error("buildBaselineFacts: NONE+BOOLEAN requires a matching visual model");
        }
        const validCount = visualModel.trueCount + visualModel.falseCount;
        return { fact1: buildYesNoFact(visualModel.trueCount, validCount), distributionFact };
      }

      if (visualModel.kind !== "NONE" || visualModel.valueKind !== "NUMERIC") {
        throw new Error("buildBaselineFacts: NONE+NUMERIC requires a matching visual model");
      }
      if (visualModel.validCount === 0 || visualModel.bins.length === 0) {
        return { fact1: `${metricName} has no valid results this period.`, distributionFact };
      }
      const modalBin = pickModalBin(visualModel.bins);
      const fact1 = `Values were concentrated between ${formatBoundary(modalBin.rangeStart, unitLabel)} and ${formatBoundary(
        modalBin.rangeEnd,
        unitLabel,
      )}.`;
      return { fact1, distributionFact };
    }
  }
}
