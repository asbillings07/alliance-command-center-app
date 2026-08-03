import type { ReactNode } from "react";
import { Card } from "@/app/src/components";
import type { AverageVisualModel, DistributionBin, NoneVisualModel } from "@/app/src/lib/reports/metricVisualModel";
import { formatMetricAverage } from "@/app/src/lib/format/formatMetricAverage";
import { formatPercent } from "@/app/src/lib/format/formatPercent";
import {
  pluralize,
  pickHistogramBoundaryPrecision,
  formatHistogramBoundary,
  formatBinRangeLabel,
  formatAverageMarkerLabel,
  formatExactMetricValue,
  clampAverageMarkerLabelPosition,
} from "./metricVisualChartDisplay";
import { ChartSection } from "./ChartSection";

const VIEWBOX_WIDTH = 320;
const VIEWBOX_HEIGHT = 140;
const BAR_AREA_X = 6;
const BAR_AREA_WIDTH = VIEWBOX_WIDTH - BAR_AREA_X * 2;
const BASELINE_Y = 108;
const MAX_BAR_HEIGHT = 78;
const BAR_GAP = 2;

/**
 * The SVG histogram shared by AVERAGE and NONE+NUMERIC (#264 PR5) — never
 * rendered for the all-equal one-bin case (that's `AllEqualDistribution`
 * below instead, since an equal-width split of a zero-width domain has no
 * meaningful geometry). Fixed viewBox coordinates scale responsively via
 * `width="100%"`; coordinate math (not adaptive JS measurement) is what
 * makes this safe to render server-side.
 */
function HistogramSvg({
  bins,
  unitLabel,
  average,
  testId,
}: {
  bins: DistributionBin[];
  unitLabel: string | null;
  average: number | null;
  testId: string;
}) {
  const maxCount = bins.reduce((max, bin) => Math.max(max, bin.count), 0);
  const barWidth = (BAR_AREA_WIDTH - BAR_GAP * (bins.length - 1)) / bins.length;
  const min = bins[0]!.rangeStart;
  const max = bins[bins.length - 1]!.rangeEnd;
  const domain = max - min;

  const markerX = average !== null && domain > 0 ? BAR_AREA_X + ((average - min) / domain) * BAR_AREA_WIDTH : null;

  return (
    <svg
      viewBox={`0 0 ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`}
      className="w-full h-auto"
      role="presentation"
      focusable="false"
      data-testid={testId}
    >
      <line x1={BAR_AREA_X} y1={BASELINE_Y} x2={BAR_AREA_X + BAR_AREA_WIDTH} y2={BASELINE_Y} stroke="var(--border)" strokeWidth={1} />
      {bins.map((bin, index) => {
        const x = BAR_AREA_X + index * (barWidth + BAR_GAP);
        const height = maxCount > 0 ? (bin.count / maxCount) * MAX_BAR_HEIGHT : 0;
        const y = BASELINE_Y - height;
        const labelY = Math.max(y - 4, 12);
        return (
          <g key={index} data-testid={`${testId}-bin-${index}`}>
            <rect x={x} y={y} width={barWidth} height={height} fill="var(--primary)" />
            <text x={x + barWidth / 2} y={labelY} textAnchor="middle" fontSize={10} fill="var(--text-muted)">
              {bin.count}
            </text>
          </g>
        );
      })}
      {markerX !== null &&
        (() => {
          // The line stays at the mathematically exact average position;
          // only the label's anchor shifts near an edge so a skewed cohort
          // (average close to the domain's min or max) can't clip
          // "Average: X" outside the viewBox.
          const label = formatAverageMarkerLabel(average!, unitLabel);
          const { x: labelX, textAnchor } = clampAverageMarkerLabelPosition(markerX, label, VIEWBOX_WIDTH, BAR_AREA_X);
          return (
            <g data-testid={`${testId}-average-marker`}>
              <line
                x1={markerX}
                y1={8}
                x2={markerX}
                y2={BASELINE_Y + 6}
                stroke="var(--text-primary)"
                strokeWidth={1.5}
                strokeDasharray="3,2"
              />
              <text x={labelX} y={7} textAnchor={textAnchor} fontSize={10} fill="var(--text-primary)" fontWeight={600}>
                {label}
              </text>
            </g>
          );
        })()}
    </svg>
  );
}

function HistogramAxisLabels({ bins, precision, unitLabel }: { bins: DistributionBin[]; precision: number; unitLabel: string | null }) {
  const min = bins[0]!.rangeStart;
  const max = bins[bins.length - 1]!.rangeEnd;
  return (
    // Plain HTML text, not SVG — deliberately never rotated, even at
    // mobile widths, per the rendering contract.
    <div className="flex justify-between text-xs text-text-muted mt-1">
      <span>{formatHistogramBoundary(min, precision, unitLabel)}</span>
      <span>{formatHistogramBoundary(max, precision, unitLabel)}</span>
    </div>
  );
}

function AllEqualDistributionBar({ value, count, unitLabel }: { value: number; count: number; unitLabel: string | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-6" data-testid="distribution-all-equal-bar">
      <div className="w-28 h-16 rounded bg-primary" />
      <p className="text-sm text-text-secondary text-center">
        All {count} valid {pluralize(count, "result", "results")} {pluralize(count, "was", "were")}{" "}
        {formatMetricAverage(value, unitLabel)}.
      </p>
    </div>
  );
}

function DistributionTable({
  bins,
  precision,
  unitLabel,
  validCount,
  caption,
}: {
  bins: DistributionBin[];
  precision: number;
  unitLabel: string | null;
  validCount: number;
  caption: string;
}) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          <th className="text-left py-2 px-3 text-text-muted font-medium">Range</th>
          <th className="text-right py-2 px-3 text-text-muted font-medium">Count</th>
          <th className="text-right py-2 px-3 text-text-muted font-medium">% of valid results</th>
        </tr>
      </thead>
      <tbody>
        {bins.map((bin, index) => (
          <tr key={index} className="border-b border-border last:border-0">
            <td className="py-2 px-3 text-text-primary">{formatBinRangeLabel(bin, index === bins.length - 1, precision, unitLabel)}</td>
            <td className="py-2 px-3 text-right text-text-primary">{bin.count}</td>
            <td className="py-2 px-3 text-right text-text-secondary">
              {validCount > 0 ? formatPercent((bin.count / validCount) * 100) : "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SingleBinTable({ bin, validCount, unitLabel, caption }: { bin: DistributionBin; validCount: number; unitLabel: string | null; caption: string }) {
  return (
    <table className="w-full text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr className="border-b border-border">
          <th className="text-left py-2 px-3 text-text-muted font-medium">Range</th>
          <th className="text-right py-2 px-3 text-text-muted font-medium">Count</th>
          <th className="text-right py-2 px-3 text-text-muted font-medium">% of valid results</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td className="py-2 px-3 text-text-primary">{formatExactMetricValue(bin.rangeStart, unitLabel)}</td>
          <td className="py-2 px-3 text-right text-text-primary">{validCount}</td>
          <td className="py-2 px-3 text-right text-text-secondary">100%</td>
        </tr>
      </tbody>
    </table>
  );
}

function ChartCard({ children }: { children: ReactNode }) {
  return (
    <div data-testid="metric-visual-section">
      <Card>
        <Card.Body>{children}</Card.Body>
      </Card>
    </div>
  );
}

/**
 * AVERAGE's distribution chart (#264 PR5) — the only kind that ever draws
 * an average marker on the histogram.
 */
export function AverageDistributionChart({ visualModel, unitLabel }: { visualModel: AverageVisualModel; unitLabel: string | null }) {
  const { average, bins, validCount } = visualModel;
  if (validCount === 0 || average === null || bins.length === 0) return null;

  if (bins.length === 1) {
    const value = bins[0]!.rangeStart;
    const summary = `All ${validCount} valid ${pluralize(validCount, "result", "results")} ${pluralize(validCount, "was", "were")} ${formatMetricAverage(value, unitLabel)}.`;
    return (
      <ChartCard>
        <ChartSection
          titleId="average-distribution-title"
          title="Value Distribution"
          summaryId="average-distribution-summary"
          summary={summary}
          dataDisclosureLabel="Chart data — 1 row"
          testId="average-distribution-chart"
          visual={<AllEqualDistributionBar value={value} count={validCount} unitLabel={unitLabel} />}
          table={<SingleBinTable bin={bins[0]!} validCount={validCount} unitLabel={unitLabel} caption={summary} />}
        />
      </ChartCard>
    );
  }

  const precision = pickHistogramBoundaryPrecision(bins);
  const summary = `Average ${formatMetricAverage(average, unitLabel)} across ${validCount} valid ${pluralize(validCount, "result", "results")}.`;

  return (
    <ChartCard>
      <ChartSection
        titleId="average-distribution-title"
        title="Value Distribution"
        summaryId="average-distribution-summary"
        summary={summary}
        dataDisclosureLabel={`Chart data — ${bins.length} rows`}
        testId="average-distribution-chart"
        visual={
          <div>
            <HistogramSvg bins={bins} unitLabel={unitLabel} average={average} testId="average-histogram" />
            <HistogramAxisLabels bins={bins} precision={precision} unitLabel={unitLabel} />
          </div>
        }
        table={<DistributionTable bins={bins} precision={precision} unitLabel={unitLabel} validCount={validCount} caption={summary} />}
      />
    </ChartCard>
  );
}

/**
 * NONE+NUMERIC's distribution chart (#264 PR5) — the same histogram as
 * AVERAGE, but never an average marker, headline average, total, or
 * percentage: a NONE-kind metric has no alliance-wide rollup by product
 * definition, and the chart must keep saying so explicitly.
 */
export function NoneNumericDistributionChart({
  visualModel,
  unitLabel,
}: {
  visualModel: Extract<NoneVisualModel, { valueKind: "NUMERIC" }>;
  unitLabel: string | null;
}) {
  const { bins, validCount } = visualModel;
  if (validCount === 0 || bins.length === 0) return null;

  const noRollupNote = "No alliance-wide rollup is defined for this metric.";

  if (bins.length === 1) {
    const value = bins[0]!.rangeStart;
    const summary = `${noRollupNote} All ${validCount} valid ${pluralize(validCount, "result", "results")} ${pluralize(validCount, "was", "were")} ${formatMetricAverage(value, unitLabel)}.`;
    return (
      <ChartCard>
        <ChartSection
          titleId="none-numeric-distribution-title"
          title="Value Distribution"
          summaryId="none-numeric-distribution-summary"
          summary={summary}
          dataDisclosureLabel="Chart data — 1 row"
          testId="none-numeric-distribution-chart"
          visual={<AllEqualDistributionBar value={value} count={validCount} unitLabel={unitLabel} />}
          table={<SingleBinTable bin={bins[0]!} validCount={validCount} unitLabel={unitLabel} caption={summary} />}
        />
      </ChartCard>
    );
  }

  const precision = pickHistogramBoundaryPrecision(bins);
  const summary = `${noRollupNote} ${validCount} valid ${pluralize(validCount, "result", "results")} recorded.`;

  return (
    <ChartCard>
      <ChartSection
        titleId="none-numeric-distribution-title"
        title="Value Distribution"
        summaryId="none-numeric-distribution-summary"
        summary={summary}
        dataDisclosureLabel={`Chart data — ${bins.length} rows`}
        testId="none-numeric-distribution-chart"
        visual={
          <div>
            <HistogramSvg bins={bins} unitLabel={unitLabel} average={null} testId="none-numeric-histogram" />
            <HistogramAxisLabels bins={bins} precision={precision} unitLabel={unitLabel} />
          </div>
        }
        table={<DistributionTable bins={bins} precision={precision} unitLabel={unitLabel} validCount={validCount} caption={summary} />}
      />
    </ChartCard>
  );
}
