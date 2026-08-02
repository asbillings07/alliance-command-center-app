import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { MetricSummaryKind } from "@/app/generated/prisma/enums";
import { PageLayout, Card, Badge, EmptyState } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type Params = {
  params: Promise<{ allianceId: string }>;
};

const SUMMARY_KIND_BADGE_LABEL: Record<MetricSummaryKind, string | null> = {
  [MetricSummaryKind.SUM]: "Total",
  [MetricSummaryKind.AVERAGE]: "Average",
  [MetricSummaryKind.TRUE_RATE]: "True rate",
  [MetricSummaryKind.NONE]: null,
};

/**
 * Reports index (#190) — a discovery hub for every alliance-configured
 * metric's report, rather than a single hardcoded "VS Contribution" page.
 * The selected metric is authoritative; any metric (numeric or boolean,
 * with or without a configured rollup) works identically.
 */
export default async function ReportsIndexPage({ params }: Params) {
  const { allianceId } = await params;
  const { permissions } = await requireAllianceAccess({ allianceId, requiredPermission: Permissions.VIEW_MEMBERS });

  const metrics = await prisma.metric.findMany({
    where: { allianceId },
    select: { id: true, name: true, description: true, summaryKind: true, unitLabel: true, active: true },
    orderBy: [{ active: "desc" }, { name: "asc" }],
  });

  return (
    <PageLayout
      breadcrumb={[{ label: "Dashboard", href: `/alliances/${allianceId}` }, { label: "Reports" }]}
      title="Reports"
      description="Metric summaries and member breakdowns for your alliance"
      maxWidth="3xl"
    >
      {metrics.length === 0 ? (
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
      ) : (
        <div className="flex flex-col gap-4" data-testid="reports-index-list">
          {metrics.map((metric) => {
            const badgeLabel = SUMMARY_KIND_BADGE_LABEL[metric.summaryKind];
            return (
              <div key={metric.id} data-testid={`reports-index-card-${metric.id}`}>
                <Card className={!metric.active ? "opacity-60" : ""}>
                  <Card.Body>
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <h2 className="text-lg font-semibold text-primary">{metric.name}</h2>
                          {badgeLabel && (
                            <Badge variant="neutral" size="sm">
                              {badgeLabel}
                              {metric.unitLabel ? ` (${metric.unitLabel})` : ""}
                            </Badge>
                          )}
                          {!metric.active && (
                            <Badge variant="neutral" size="sm">
                              Archived
                            </Badge>
                          )}
                        </div>
                        {metric.description && <p className="text-sm text-text-secondary">{metric.description}</p>}
                      </div>
                      <Button href={`/alliances/${allianceId}/reports/metrics/${metric.id}`} variant="primary" size="sm">
                        View Report
                      </Button>
                    </div>
                  </Card.Body>
                </Card>
              </div>
            );
          })}
        </div>
      )}
    </PageLayout>
  );
}
