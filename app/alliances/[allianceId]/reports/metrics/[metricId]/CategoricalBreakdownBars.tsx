import type { ReactNode } from "react";
import { Card } from "@/app/src/components";
import type { TrueRateVisualModel, NoneVisualModel } from "@/app/src/lib/reports/metricVisualModel";
import type { MetricCoverage } from "@/app/src/lib/reports/getMetricSummaryReport";
import { formatPercent } from "@/app/src/lib/format/formatPercent";
import { pluralize } from "./metricVisualChartDisplay";
import { ChartSection } from "./ChartSection";

function ChartCard({ children }: { children: ReactNode }) {
  return (
    <div data-testid="metric-visual-section">
      <Card>
        <Card.Body>{children}</Card.Body>
      </Card>
    </div>
  );
}

type Segment = { label: string; count: number; colorClass: string };

/**
 * One labeled category bar (#264 PR5) — used for both the recorded
 * response distribution and the active-roster coverage bar. Renders no
 * segment at all for a zero count, matching SUM's "no visible fill for a
 * zero value" treatment, and always lists every category's exact count
 * below the bar (color reinforces category, but the count text is what
 * actually communicates it).
 */
function CategoricalBar({ segments, total, testId }: { segments: Segment[]; total: number; testId: string }) {
  return (
    <div className="flex flex-col gap-2" data-testid={testId}>
      <div className="flex h-4 w-full rounded overflow-hidden bg-surface-secondary">
        {segments.map((segment) => {
          const pct = total > 0 ? (segment.count / total) * 100 : 0;
          return pct > 0 ? <div key={segment.label} className={`h-full ${segment.colorClass}`} style={{ width: `${pct}%` }} /> : null;
        })}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-secondary">
        {segments.map((segment) => (
          <span key={segment.label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block w-2.5 h-2.5 rounded-sm ${segment.colorClass}`} />
            {segment.label}: {segment.count}
          </span>
        ))}
      </div>
    </div>
  );
}

function ResponseAndCoverageTables({
  trueCount,
  falseCount,
  invalidCount,
  coverage,
  showRate,
}: {
  trueCount: number;
  falseCount: number;
  invalidCount: number;
  coverage: MetricCoverage;
  showRate: boolean;
}) {
  const validCount = trueCount + falseCount;
  return (
    <div className="flex flex-col gap-4">
      <table className="w-full text-sm">
        <caption className="sr-only">Recorded response distribution</caption>
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 text-text-muted font-medium">Response</th>
            <th className="text-right py-2 px-3 text-text-muted font-medium">Count</th>
            {showRate && <th className="text-right py-2 px-3 text-text-muted font-medium">Share of valid responses</th>}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <td className="py-2 px-3 text-text-primary">Yes</td>
            <td className="py-2 px-3 text-right text-text-primary">{trueCount}</td>
            {showRate && (
              <td className="py-2 px-3 text-right text-text-secondary">
                {validCount > 0 ? formatPercent((trueCount / validCount) * 100) : "—"}
              </td>
            )}
          </tr>
          <tr className="border-b border-border">
            <td className="py-2 px-3 text-text-primary">No</td>
            <td className="py-2 px-3 text-right text-text-primary">{falseCount}</td>
            {showRate && (
              <td className="py-2 px-3 text-right text-text-secondary">
                {validCount > 0 ? formatPercent((falseCount / validCount) * 100) : "—"}
              </td>
            )}
          </tr>
          <tr className="last:border-0">
            <td className="py-2 px-3 text-text-primary">Invalid</td>
            <td className="py-2 px-3 text-right text-text-primary">{invalidCount}</td>
            {showRate && <td className="py-2 px-3 text-right text-text-secondary">—</td>}
          </tr>
        </tbody>
      </table>
      <table className="w-full text-sm">
        <caption className="sr-only">Active-roster coverage</caption>
        <thead>
          <tr className="border-b border-border">
            <th className="text-left py-2 px-3 text-text-muted font-medium">Category</th>
            <th className="text-right py-2 px-3 text-text-muted font-medium">Count</th>
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-border">
            <td className="py-2 px-3 text-text-primary">Valid recorded</td>
            <td className="py-2 px-3 text-right text-text-primary">{coverage.recordedActiveMemberCount}</td>
          </tr>
          <tr className="border-b border-border">
            <td className="py-2 px-3 text-text-primary">Invalid</td>
            <td className="py-2 px-3 text-right text-text-primary">{coverage.invalidActiveMemberCount}</td>
          </tr>
          <tr className="last:border-0">
            <td className="py-2 px-3 text-text-primary">Missing</td>
            <td className="py-2 px-3 text-right text-text-primary">{coverage.missingActiveMemberCount}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function ResponseAndCoverageBars({
  trueCount,
  falseCount,
  invalidCount,
  coverage,
  testIdPrefix,
}: {
  trueCount: number;
  falseCount: number;
  invalidCount: number;
  coverage: MetricCoverage;
  testIdPrefix: string;
}) {
  const recordedTotal = trueCount + falseCount + invalidCount;
  return (
    <div className="flex flex-col gap-5" data-testid={`${testIdPrefix}-bars`}>
      <div>
        <p className="text-xs font-medium text-text-muted mb-1.5">Recorded response distribution</p>
        <CategoricalBar
          segments={[
            { label: "Yes", count: trueCount, colorClass: "bg-success" },
            { label: "No", count: falseCount, colorClass: "bg-text-muted" },
            { label: "Invalid", count: invalidCount, colorClass: "bg-warning" },
          ]}
          total={recordedTotal}
          testId={`${testIdPrefix}-response-bar`}
        />
      </div>
      <div>
        <p className="text-xs font-medium text-text-muted mb-1.5">Active-roster coverage</p>
        <CategoricalBar
          segments={[
            { label: "Valid recorded", count: coverage.recordedActiveMemberCount, colorClass: "bg-success" },
            { label: "Invalid", count: coverage.invalidActiveMemberCount, colorClass: "bg-warning" },
            { label: "Missing", count: coverage.missingActiveMemberCount, colorClass: "bg-text-muted" },
          ]}
          total={coverage.currentActiveMemberCount}
          testId={`${testIdPrefix}-coverage-bar`}
        />
      </div>
    </div>
  );
}

function archivedContributorsNote(coverage: MetricCoverage): string {
  if (coverage.archivedContributingMemberCount === 0) return "";
  return ` Recorded response totals include ${coverage.archivedContributingMemberCount} archived ${pluralize(coverage.archivedContributingMemberCount, "contributor", "contributors")}; active-roster coverage does not.`;
}

/**
 * TRUE_RATE's chart (#264 PR5) — deliberately two separate bars rather than
 * one four-segment bar: recorded response counts can include archived
 * contributors, while active-roster coverage never does, so the two don't
 * share one denominator.
 */
export function TrueRateBreakdownChart({ visualModel, coverage }: { visualModel: TrueRateVisualModel; coverage: MetricCoverage }) {
  const { trueCount, falseCount, invalidCount } = visualModel;
  const recordedTotal = trueCount + falseCount + invalidCount;
  if (recordedTotal === 0 && coverage.currentActiveMemberCount === 0) return null;

  const validCount = trueCount + falseCount;
  const rateText =
    validCount > 0
      ? `${formatPercent((trueCount / validCount) * 100)} Yes, of ${validCount} valid ${pluralize(validCount, "response", "responses")}.`
      : "No valid Yes/No responses recorded yet.";
  const summary = `${rateText}${archivedContributorsNote(coverage)}`;

  return (
    <ChartCard>
      <ChartSection
        titleId="true-rate-breakdown-title"
        title="Response Breakdown"
        summaryId="true-rate-breakdown-summary"
        summary={summary}
        dataDisclosureLabel="Chart data — response and coverage tables"
        testId="true-rate-breakdown-chart"
        visual={
          <ResponseAndCoverageBars
            trueCount={trueCount}
            falseCount={falseCount}
            invalidCount={invalidCount}
            coverage={coverage}
            testIdPrefix="true-rate"
          />
        }
        table={
          <ResponseAndCoverageTables
            trueCount={trueCount}
            falseCount={falseCount}
            invalidCount={invalidCount}
            coverage={coverage}
            showRate
          />
        }
      />
    </ChartCard>
  );
}

/**
 * NONE+BOOLEAN's chart (#264 PR5) — the same two-bar categorical layout as
 * TRUE_RATE, but never a rate headline: a NONE-kind metric has no
 * alliance-wide rollup by product definition.
 */
export function NoneBooleanBreakdownChart({
  visualModel,
  coverage,
}: {
  visualModel: Extract<NoneVisualModel, { valueKind: "BOOLEAN" }>;
  coverage: MetricCoverage;
}) {
  const { trueCount, falseCount, invalidCount } = visualModel;
  const recordedTotal = trueCount + falseCount + invalidCount;
  if (recordedTotal === 0 && coverage.currentActiveMemberCount === 0) return null;

  const summary = `No alliance-wide rollup is defined for this metric.${archivedContributorsNote(coverage)}`;

  return (
    <ChartCard>
      <ChartSection
        titleId="none-boolean-breakdown-title"
        title="Response Breakdown"
        summaryId="none-boolean-breakdown-summary"
        summary={summary}
        dataDisclosureLabel="Chart data — response and coverage tables"
        testId="none-boolean-breakdown-chart"
        visual={
          <ResponseAndCoverageBars
            trueCount={trueCount}
            falseCount={falseCount}
            invalidCount={invalidCount}
            coverage={coverage}
            testIdPrefix="none-boolean"
          />
        }
        table={
          <ResponseAndCoverageTables
            trueCount={trueCount}
            falseCount={falseCount}
            invalidCount={invalidCount}
            coverage={coverage}
            showRate={false}
          />
        }
      />
    </ChartCard>
  );
}
