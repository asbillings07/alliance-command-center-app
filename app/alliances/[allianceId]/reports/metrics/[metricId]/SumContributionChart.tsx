import { Badge, Card } from "@/app/src/components";
import type { SumVisualModel, SumTopContributor } from "@/app/src/lib/reports/metricVisualModel";
import type { MetricShareAvailability } from "@/app/src/lib/reports/metricRollup";
import { formatMetricValue } from "@/app/src/lib/format/formatMetricValue";
import { formatPercent } from "@/app/src/lib/format/formatPercent";
import {
  pluralize,
  classifySumDivergingMode,
  maxAbsoluteContributorValue,
  formatSignedMetricValue,
  type SumDivergingMode,
} from "./metricVisualChartDisplay";
import { ChartSection } from "./ChartSection";

type Props = {
  visualModel: SumVisualModel;
  unitLabel: string | null;
};

function ContributorName({ contributor }: { contributor: SumTopContributor }) {
  return (
    <>
      <span className="font-medium text-text-primary">{contributor.playerName}</span>
      {contributor.archived && (
        <Badge variant="neutral" size="sm">
          Archived
        </Badge>
      )}
    </>
  );
}

function SumShareRow({ contributor, rank, unitLabel }: { contributor: SumTopContributor; rank: number; unitLabel: string | null }) {
  const pct = contributor.percentageOfTotal ?? 0;
  return (
    <div className="flex flex-col gap-1" data-testid={`sum-share-row-${contributor.allianceMemberId}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <span className="text-text-muted">#{rank}</span>
        <ContributorName contributor={contributor} />
        <span className="ml-auto text-text-secondary" title={formatMetricValue(contributor.value, unitLabel).exact}>
          {formatMetricValue(contributor.value, unitLabel).compact} ({formatPercent(pct)})
        </span>
      </div>
      <div className="h-3 w-full rounded bg-surface-secondary overflow-hidden">
        {pct > 0 && <div className="h-full rounded bg-primary" style={{ width: `${pct}%` }} />}
      </div>
    </div>
  );
}

function SumShareTable({ topContributors, unitLabel, caption }: { topContributors: SumTopContributor[]; unitLabel: string | null; caption: string }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          <th className="text-left py-2 px-3 text-text-muted font-medium">Rank</th>
          <th className="text-left py-2 px-3 text-text-muted font-medium">Member</th>
          <th className="text-right py-2 px-3 text-text-muted font-medium">Value</th>
          <th className="text-right py-2 px-3 text-text-muted font-medium">Share of total</th>
        </tr>
      </thead>
      <tbody>
        {topContributors.map((contributor, index) => (
          <tr key={contributor.allianceMemberId} className="border-b border-border last:border-0">
            <td className="py-2 px-3 text-text-muted">#{index + 1}</td>
            <td className="py-2 px-3">
              <div className="flex items-center gap-2">
                <ContributorName contributor={contributor} />
              </div>
            </td>
            <td className="py-2 px-3 text-right text-text-primary">{formatMetricValue(contributor.value, unitLabel).compact}</td>
            <td className="py-2 px-3 text-right text-text-secondary">{formatPercent(contributor.percentageOfTotal ?? 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SumShareChart({
  topContributors,
  consideredCount,
  unitLabel,
}: {
  topContributors: SumTopContributor[];
  consideredCount: number;
  unitLabel: string | null;
}) {
  const totalSharePercent = topContributors.reduce((sum, c) => sum + (c.percentageOfTotal ?? 0), 0);
  const summary = `Top ${topContributors.length} of ${consideredCount} recorded ${pluralize(consideredCount, "contributor", "contributors")}, accounting for ${formatPercent(totalSharePercent)} of the total.`;

  return (
    <ChartSection
      titleId="sum-chart-title"
      title="Contribution Breakdown"
      summaryId="sum-chart-summary"
      summary={summary}
      dataDisclosureLabel={`Chart data — ${topContributors.length} row${topContributors.length === 1 ? "" : "s"}`}
      testId="sum-share-chart"
      visual={
        <div className="flex flex-col gap-3" data-testid="sum-share-bars">
          {topContributors.map((contributor, index) => (
            <SumShareRow key={contributor.allianceMemberId} contributor={contributor} rank={index + 1} unitLabel={unitLabel} />
          ))}
        </div>
      }
      table={<SumShareTable topContributors={topContributors} unitLabel={unitLabel} caption={summary} />}
    />
  );
}

function SumDivergingRow({
  contributor,
  maxAbs,
  mode,
  unitLabel,
}: {
  contributor: SumTopContributor;
  maxAbs: number;
  mode: SumDivergingMode;
  unitLabel: string | null;
}) {
  const pct = maxAbs > 0 ? (Math.abs(contributor.value) / maxAbs) * 100 : 0;
  const direction = contributor.value > 0 ? "Adds to total" : contributor.value < 0 ? "Subtracts from total" : null;
  // Color reinforces sign but never solely communicates it — direction
  // text, the explicit signed value, and the bar's own left/right position
  // relative to the zero baseline all say the same thing independently.
  const barColorClass = contributor.value > 0 ? "bg-primary" : "bg-warning";

  return (
    <div className="flex flex-col gap-1" data-testid={`sum-diverging-row-${contributor.allianceMemberId}`}>
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
        <ContributorName contributor={contributor} />
        {direction && <span className="text-text-muted text-xs">{direction}</span>}
        <span className="ml-auto font-medium text-text-primary">{formatSignedMetricValue(contributor.value, unitLabel)}</span>
      </div>
      {mode === "MIXED" ? (
        <div className="grid grid-cols-[1fr_2px_1fr] items-center h-3">
          <div className="flex justify-end h-full">
            {contributor.value < 0 && (
              <div className={`h-full rounded-l ${barColorClass}`} style={{ width: `${pct}%` }} />
            )}
          </div>
          <div className="h-full bg-border" />
          <div className="flex justify-start h-full">
            {contributor.value > 0 && (
              <div className={`h-full rounded-r ${barColorClass}`} style={{ width: `${pct}%` }} />
            )}
          </div>
        </div>
      ) : (
        // ALL_NEGATIVE: zero sits at the right edge, using the full plot
        // width rather than wasting an empty positive half.
        <div className="flex justify-end h-3 w-full">
          <div className={`h-full rounded-l ${barColorClass}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

function SumDivergingTable({
  topContributors,
  unitLabel,
  caption,
}: {
  topContributors: SumTopContributor[];
  unitLabel: string | null;
  caption: string;
}) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          <th className="text-left py-2 px-3 text-text-muted font-medium">Member</th>
          <th className="text-left py-2 px-3 text-text-muted font-medium">Direction</th>
          <th className="text-right py-2 px-3 text-text-muted font-medium">Value</th>
        </tr>
      </thead>
      <tbody>
        {topContributors.map((contributor) => (
          <tr key={contributor.allianceMemberId} className="border-b border-border last:border-0">
            <td className="py-2 px-3">
              <div className="flex items-center gap-2">
                <ContributorName contributor={contributor} />
              </div>
            </td>
            <td className="py-2 px-3 text-text-secondary">
              {contributor.value > 0 ? "Adds to total" : contributor.value < 0 ? "Subtracts from total" : "No net effect"}
            </td>
            <td className="py-2 px-3 text-right text-text-primary">{formatSignedMetricValue(contributor.value, unitLabel)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SumDivergingChart({
  topContributors,
  shareAvailability,
  consideredCount,
  unitLabel,
}: {
  topContributors: SumTopContributor[];
  shareAvailability: Extract<MetricShareAvailability, { available: false }>;
  consideredCount: number;
  unitLabel: string | null;
}) {
  const mode = classifySumDivergingMode(shareAvailability, topContributors);
  const rowCount = topContributors.length;
  const dataDisclosureLabel = `Chart data — ${rowCount} row${rowCount === 1 ? "" : "s"}`;

  if (mode === "ALL_ZERO") {
    const summary = "All recorded contributions were 0.";
    return (
      <ChartSection
        titleId="sum-chart-title"
        title="Contribution Breakdown"
        summaryId="sum-chart-summary"
        summary={summary}
        dataDisclosureLabel={dataDisclosureLabel}
        testId="sum-diverging-chart"
        visual={
          <p className="text-sm text-text-muted italic py-4" data-testid="sum-diverging-zero-state">
            {summary}
          </p>
        }
        table={<SumDivergingTable topContributors={topContributors} unitLabel={unitLabel} caption={summary} />}
      />
    );
  }

  const summary =
    mode === "ALL_NEGATIVE"
      ? "All recorded contributions were non-positive; member shares are unavailable."
      : `Top ${rowCount} of ${consideredCount} recorded ${pluralize(consideredCount, "contributor", "contributors")}. Member shares are unavailable because the cohort includes negative values.`;

  const maxAbs = maxAbsoluteContributorValue(topContributors);

  return (
    <ChartSection
      titleId="sum-chart-title"
      title="Contribution Breakdown"
      summaryId="sum-chart-summary"
      summary={summary}
      dataDisclosureLabel={dataDisclosureLabel}
      testId="sum-diverging-chart"
      visual={
        <div className="flex flex-col gap-3" data-testid="sum-diverging-bars">
          {mode === "MIXED" && (
            <div className="flex text-xs text-text-muted px-1">
              <span className="flex-1 text-right pr-1">Subtracts from total</span>
              <span className="w-0.5" />
              <span className="flex-1 pl-1">Adds to total</span>
            </div>
          )}
          {topContributors.map((contributor) => (
            <SumDivergingRow key={contributor.allianceMemberId} contributor={contributor} maxAbs={maxAbs} mode={mode} unitLabel={unitLabel} />
          ))}
        </div>
      }
      table={<SumDivergingTable topContributors={topContributors} unitLabel={unitLabel} caption={summary} />}
    />
  );
}

/**
 * SUM's chart dispatcher (#264 PR5) — the model's own `shareAvailability`
 * decides normal ranked-share bars vs. diverging raw-value bars; the
 * component never re-derives that decision from the raw values itself.
 */
export function SumContributionChart({ visualModel, unitLabel }: Props) {
  const { shareAvailability, topContributors, consideredCount } = visualModel;
  if (topContributors.length === 0) return null;

  const chart = shareAvailability.available ? (
    <SumShareChart topContributors={topContributors} consideredCount={consideredCount} unitLabel={unitLabel} />
  ) : (
    <SumDivergingChart
      topContributors={topContributors}
      shareAvailability={shareAvailability}
      consideredCount={consideredCount}
      unitLabel={unitLabel}
    />
  );

  return (
    <div data-testid="metric-visual-section">
      <Card>
        <Card.Body>{chart}</Card.Body>
      </Card>
    </div>
  );
}
