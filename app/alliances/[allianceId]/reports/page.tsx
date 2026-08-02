import { notFound } from "next/navigation";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { isFeatureEnabled } from "@/app/src/lib/features";
import {
  getAlliancePerformanceReport,
  AlliancePerformanceReportNotFoundError,
} from "@/app/src/lib/reports/getAlliancePerformanceReport";
import { listAlliancePeriodOptions } from "@/app/src/lib/reports/listAlliancePeriodOptions";
import { PageLayout, EmptyState } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { AlliancePeriodSelect } from "./AlliancePeriodSelect";
import { AllianceComparisonControl } from "./AllianceComparisonControl";
import { AllianceAtAGlanceCards } from "./AllianceAtAGlanceCards";
import { AllianceMetricPerformanceCard } from "./AllianceMetricPerformanceCard";

type Params = {
  params: Promise<{ allianceId: string }>;
  searchParams: Promise<{ periodId?: string; comparePeriodId?: string }>;
};

const breadcrumbFor = (allianceId: string) => [
  { label: "Dashboard", href: `/alliances/${allianceId}` },
  { label: "Reports" },
];

/**
 * Alliance performance overview (#264) — replaces the flat per-metric
 * directory (#190's original `/reports`) with a period-scoped snapshot of
 * every configured metric at once. The per-metric drill-down page
 * (`/reports/metrics/[metricId]`) remains the detailed roster/member view;
 * this page answers "how is the alliance doing this period," not "who
 * contributed what."
 */
export default async function ReportsIndexPage({ params, searchParams }: Params) {
  if (!isFeatureEnabled("reports")) {
    notFound();
  }

  const { allianceId } = await params;
  const sp = await searchParams;
  const { permissions } = await requireAllianceAccess({ allianceId, requiredPermission: Permissions.VIEW_MEMBERS });

  const periodOptions = await listAlliancePeriodOptions(allianceId);

  let periodId = sp.periodId;
  if (!periodId) {
    // The current active period is just the first ACTIVE entry here —
    // `periodOptions` is already ordered newest-first via the same
    // `metricPeriodChronologicalOrderBy` that `resolveTargetPeriod` uses,
    // so a second DB round-trip to re-derive the same answer isn't needed.
    // Falls back to the most recently configured period (any status) when
    // the alliance has no active period at all — a report for an
    // archived/completed period is still meaningful.
    periodId = periodOptions.find((p) => p.active)?.id ?? periodOptions[0]?.id;
  }

  if (!periodId) {
    return (
      <PageLayout breadcrumb={breadcrumbFor(allianceId)} title="Reports" maxWidth="3xl">
        <EmptyState
          title="No evaluation periods configured yet"
          description="The alliance performance report is generated per evaluation period. Create one first, then attach metrics and record results."
          action={
            permissions.canConfigurePeriods ? (
              <Button href={`/alliances/${allianceId}/periods`} variant="primary">
                Go to Evaluation Periods
              </Button>
            ) : undefined
          }
          secondaryAction={
            !permissions.canConfigurePeriods ? (
              <p className="text-sm text-text-secondary">Ask an Admin or Owner to set up an evaluation period.</p>
            ) : undefined
          }
        />
      </PageLayout>
    );
  }

  let report;
  try {
    report = await getAlliancePerformanceReport({
      allianceId,
      periodId,
      comparePeriodId: sp.comparePeriodId || undefined,
    });
  } catch (err) {
    if (err instanceof AlliancePerformanceReportNotFoundError) {
      notFound();
    }
    throw err;
  }

  if (report.metrics.length === 0) {
    return (
      <PageLayout breadcrumb={breadcrumbFor(allianceId)} title="Reports" maxWidth="3xl">
        <EmptyState
          title="No metrics configured yet"
          description="Reports are generated from your alliance's configured metrics. Create a metric first, then attach it to an evaluation period and record results to see a report."
          action={
            permissions.canConfigureMetrics ? (
              <Button href={`/alliances/${allianceId}/metrics`} variant="primary">
                Go to Metrics Library
              </Button>
            ) : undefined
          }
          secondaryAction={
            !permissions.canConfigureMetrics ? (
              <p className="text-sm text-text-secondary">Ask an Admin or Owner to configure metrics.</p>
            ) : undefined
          }
        />
      </PageLayout>
    );
  }

  // Guarantee the currently-selected period always appears in the dropdown,
  // even if it's somehow absent from `periodOptions` (defensive only —
  // `listAlliancePeriodOptions` lists every alliance period, so this
  // shouldn't normally happen).
  const periodOptionsWithSelected = periodOptions.some((o) => o.id === report.period.id)
    ? periodOptions
    : [{ id: report.period.id, name: report.period.name, active: report.period.active }, ...periodOptions];

  // Carried into each card's drill-down link so the resolved shared
  // comparison period survives the trip: without it, the per-metric page
  // would independently re-resolve its own default comparison, which can
  // silently land on a different period than the one this overview showed.
  const resolvedComparePeriodId =
    report.comparisonSelection.status === "RESOLVED" ? report.comparisonSelection.period.id : undefined;

  return (
    <PageLayout
      breadcrumb={breadcrumbFor(allianceId)}
      title="Reports"
      description="Alliance-wide performance across every configured metric"
      maxWidth="4xl"
    >
      <div className="flex flex-col gap-6" data-testid="alliance-reports-page">
        <div className="flex flex-col sm:flex-row sm:items-end gap-4 p-4 bg-surface border border-border rounded-lg">
          <div className="flex-1">
            <AlliancePeriodSelect
              allianceId={allianceId}
              periodOptions={periodOptionsWithSelected}
              selectedPeriodId={report.period.id}
            />
          </div>
          <div className="flex-1">
            <AllianceComparisonControl allianceId={allianceId} comparisonSelection={report.comparisonSelection} />
          </div>
        </div>

        <AllianceAtAGlanceCards totalMetricCount={report.metrics.length} overallCoverage={report.overallCoverage} />

        <div className="flex flex-col gap-4" data-testid="alliance-metric-cards">
          {report.metrics.map((performance) => (
            <AllianceMetricPerformanceCard
              key={performance.metric.id}
              allianceId={allianceId}
              periodId={report.period.id}
              comparePeriodId={resolvedComparePeriodId}
              performance={performance}
            />
          ))}
        </div>
      </div>
    </PageLayout>
  );
}
