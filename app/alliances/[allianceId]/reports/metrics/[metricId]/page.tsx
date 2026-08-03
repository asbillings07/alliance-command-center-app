import { notFound } from "next/navigation";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { isFeatureEnabled } from "@/app/src/lib/features";
import { prisma } from "@/app/src/lib/prisma";
import { MetricSummaryKind } from "@/app/generated/prisma/enums";
import {
  getMetricSummaryReport,
  MetricSummaryReportNotFoundError,
  normalizeSort,
  normalizeFilter,
} from "@/app/src/lib/reports/getMetricSummaryReport";
import { resolveDefaultReportPeriod } from "@/app/src/lib/reports/resolveDefaultReportPeriod";
import { listReportPeriodOptions } from "@/app/src/lib/reports/listReportPeriodOptions";
import { PageLayout, Card, Badge, EmptyState } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { MetricReportPeriodSelect, type PeriodSelectOption } from "./MetricReportPeriodSelect";
import { MetricComparisonControl } from "./MetricComparisonControl";
import { MetricRollupCard } from "./MetricRollupCard";
import { MetricCoverageCard } from "./MetricCoverageCard";
import { MetricInterpretationSummaryCard } from "./MetricInterpretationSummaryCard";
import { MetricVisualSection } from "./MetricVisualSection";
import { MetricReportFilterControls } from "./MetricReportFilterControls";
import { MetricReportTable } from "./MetricReportTable";

type Params = {
  params: Promise<{ allianceId: string; metricId: string }>;
  searchParams: Promise<{
    periodId?: string;
    comparePeriodId?: string;
    sort?: string;
    filter?: string;
    search?: string;
    page?: string;
  }>;
};

const SUMMARY_KIND_DESCRIPTION: Record<MetricSummaryKind, string> = {
  [MetricSummaryKind.SUM]: "Reported as an alliance total",
  [MetricSummaryKind.AVERAGE]: "Reported as an alliance average",
  [MetricSummaryKind.TRUE_RATE]: "Reported as a completion rate",
  [MetricSummaryKind.NONE]: "Reported per-member, with no alliance-wide rollup",
};

export default async function MetricReportPage({ params, searchParams }: Params) {
  if (!isFeatureEnabled("reports")) {
    notFound();
  }

  const { allianceId, metricId } = await params;
  const sp = await searchParams;

  const auth = await requireAllianceAccess({ allianceId, requiredPermission: Permissions.VIEW_MEMBERS });
  const { permissions } = auth;

  const metric = await prisma.metric.findFirst({
    where: { id: metricId, allianceId },
    select: { id: true, name: true, description: true },
  });
  if (!metric) {
    notFound();
  }

  const breadcrumb = [
    { label: "Dashboard", href: `/alliances/${allianceId}` },
    { label: "Reports", href: `/alliances/${allianceId}/reports` },
    { label: metric.name },
  ];

  const periodOptions = await listReportPeriodOptions(allianceId, metricId);

  let periodId = sp.periodId;
  if (!periodId) {
    const defaultPeriod = await resolveDefaultReportPeriod(allianceId, metricId);
    if (!defaultPeriod) {
      return (
        <PageLayout breadcrumb={breadcrumb} title={metric.name} maxWidth="3xl">
          <EmptyState
            title="Not attached to any evaluation period yet"
            description={`${metric.name} has never been attached to an evaluation period, so there's no report to show yet. Attach it to a period and record or import results to start reporting.`}
            action={
              permissions.canConfigurePeriods ? (
                <Button href={`/alliances/${allianceId}/periods`} variant="primary">
                  Go to Evaluation Periods
                </Button>
              ) : undefined
            }
            secondaryAction={
              !permissions.canConfigurePeriods ? (
                <p className="text-sm text-text-secondary">Ask an Admin or Owner to attach this metric to a period.</p>
              ) : undefined
            }
          />
        </PageLayout>
      );
    }
    periodId = defaultPeriod.id;
  }

  let report;
  try {
    report = await getMetricSummaryReport({
      allianceId,
      metricId,
      periodId,
      comparePeriodId: sp.comparePeriodId || undefined,
      sort: normalizeSort(sp.sort),
      filter: normalizeFilter(sp.filter),
      search: sp.search,
      page: sp.page ? Number(sp.page) : undefined,
    });
  } catch (err) {
    if (err instanceof MetricSummaryReportNotFoundError) {
      notFound();
    }
    throw err;
  }

  // Guarantee the currently-selected period always appears in the dropdown,
  // even when it isn't in this metric's normal attachment history (e.g. a
  // NOT_ATTACHED period reached via a direct/bookmarked URL) — otherwise the
  // <select> would silently show a different period as "selected".
  const periodOptionsWithSelected: PeriodSelectOption[] = periodOptions.some((o) => o.id === report.period.id)
    ? periodOptions
    : [
        {
          id: report.period.id,
          name: report.period.name,
          periodActive: report.period.active,
          attachmentActive: false,
          notAttached: true,
        },
        ...periodOptions,
      ];

  return (
    <PageLayout
      breadcrumb={breadcrumb}
      title={metric.name}
      description={metric.description ?? SUMMARY_KIND_DESCRIPTION[report.metric.summaryKind]}
      maxWidth="4xl"
      action={
        permissions.canConfigureMetrics ? (
          <Button href={`/alliances/${allianceId}/metrics`} variant="secondary" size="sm">
            Manage Metric
          </Button>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-6" data-testid="metric-report-page">
        {!report.metric.active && (
          <div className="p-3 bg-surface-secondary border border-border rounded-lg text-sm text-text-secondary">
            This metric is archived. Historical reports remain available.
          </div>
        )}

        <Card>
          <Card.Body>
            <div className="flex flex-col sm:flex-row sm:items-end gap-4">
              <div className="flex-1">
                <MetricReportPeriodSelect
                  allianceId={allianceId}
                  metricId={metricId}
                  periodOptions={periodOptionsWithSelected}
                  selectedPeriodId={report.period.id}
                />
              </div>
              {report.attachmentStatus === "NOT_ATTACHED" && (
                <span data-testid="attachment-status-badge">
                  <Badge variant="warning" size="sm">
                    Not attached
                  </Badge>
                </span>
              )}
              {report.attachmentStatus === "INACTIVE" && (
                <span data-testid="attachment-status-badge">
                  <Badge variant="neutral" size="sm">
                    Inactive attachment
                  </Badge>
                </span>
              )}
            </div>

            {report.attachmentStatus === "NOT_ATTACHED" && (
              <p className="text-sm text-text-secondary mt-3" data-testid="not-attached-message">
                {metric.name} isn&apos;t attached to {report.period.name}.{" "}
                {permissions.canConfigurePeriods ? (
                  <Button href={`/alliances/${allianceId}/periods/${report.period.id}`} variant="link" size="sm">
                    Attach it to this period
                  </Button>
                ) : (
                  "Ask an Admin or Owner to attach it."
                )}
              </p>
            )}
            {report.attachmentStatus === "INACTIVE" && report.dataStatus === "HAS_VALUES" && (
              <p className="text-sm text-text-secondary mt-3" data-testid="inactive-attachment-message">
                This metric&apos;s attachment to {report.period.name} is inactive. Historical results recorded while it
                was active are still shown below.
              </p>
            )}
          </Card.Body>
        </Card>

        {report.dataStatus === "NO_VALUES" ? (
          <Card>
            <Card.Body>
              {report.attachmentStatus === "INACTIVE" ? (
                // Recording/importing only ever target *active* attachments
                // (the record page's metric picker and the import
                // resolution both require it) — offering "Record Now" here
                // would be a dead end. The fix is reactivating the
                // attachment, which only a period-configuring role can do.
                <EmptyState
                  title={`${metric.name}'s attachment to ${report.period.name} is inactive`}
                  description="No results can be recorded or imported while a metric's attachment to a period is inactive."
                  action={
                    permissions.canConfigurePeriods ? (
                      <Button href={`/alliances/${allianceId}/periods/${report.period.id}`} variant="primary" size="sm">
                        Reactivate This Attachment
                      </Button>
                    ) : undefined
                  }
                  secondaryAction={
                    !permissions.canConfigurePeriods ? (
                      <p className="text-sm text-text-secondary">
                        Ask an Admin or Owner to reactivate it for {report.period.name}.
                      </p>
                    ) : undefined
                  }
                />
              ) : (
                <EmptyState
                  title={`No results recorded yet for ${report.period.name}`}
                  description={
                    report.coverage.currentActiveMemberCount > 0
                      ? `0 of ${report.coverage.currentActiveMemberCount} current active members have a recorded value.`
                      : undefined
                  }
                  action={
                    report.attachmentStatus === "ACTIVE" && permissions.canImportMetrics ? (
                      <div className="flex gap-2">
                        <Button href={`/alliances/${allianceId}/periods/${report.period.id}/record`} variant="primary" size="sm">
                          Record Now
                        </Button>
                        <Button href={`/alliances/${allianceId}/periods/${report.period.id}/import`} variant="secondary" size="sm">
                          Import Results
                        </Button>
                      </div>
                    ) : undefined
                  }
                  secondaryAction={
                    report.attachmentStatus === "ACTIVE" && !permissions.canImportMetrics ? (
                      <p className="text-sm text-text-secondary">Ask an Admin or Owner to record or import results.</p>
                    ) : undefined
                  }
                />
              )}
            </Card.Body>
          </Card>
        ) : null}

        {/*
          Rendered independently of the dataStatus branch above:
          NO_DATA_IN_SELECTED_PERIOD (the comparison period has data even
          though this one doesn't) is only reachable when dataStatus is
          NO_VALUES, so nesting it inside the "has values" branch below
          would make it permanently unreachable.
        */}
        {report.dataStatus === "NO_VALUES" && report.comparison?.status === "NO_DATA_IN_SELECTED_PERIOD" && (
          <Card>
            <Card.Body>
              <MetricComparisonControl allianceId={allianceId} metricId={metricId} comparison={report.comparison} />
            </Card.Body>
          </Card>
        )}

        {report.dataStatus !== "NO_VALUES" && (
          <>
            <MetricRollupCard
              allianceId={allianceId}
              metricId={metricId}
              metric={report.metric}
              rollup={report.rollup}
              comparison={report.comparison}
            />

            <MetricCoverageCard coverage={report.coverage} filter={report.filter} />

            <MetricInterpretationSummaryCard interpretationSummary={report.interpretationSummary} />

            <MetricVisualSection metric={report.metric} visualModel={report.visualModel} coverage={report.coverage} />

            <Card>
              <Card.Header>Members</Card.Header>
              <Card.Body className="flex flex-col gap-4">
                <MetricReportFilterControls
                  allianceId={allianceId}
                  metricId={metricId}
                  sort={report.sort}
                  filter={report.filter}
                  search={report.search}
                  page={report.pagination.page}
                  pageSize={report.pagination.pageSize}
                  totalRowCount={report.pagination.totalRowCount}
                />
                <MetricReportTable metric={report.metric} rows={report.rows} />
              </Card.Body>
            </Card>
          </>
        )}
      </div>
    </PageLayout>
  );
}
