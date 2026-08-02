import { Metric_Type } from "@/app/generated/prisma/enums";
import { Badge } from "@/app/src/components";
import type { MetricInfo, MetricReportRow } from "@/app/src/lib/reports/getMetricSummaryReport";
import { formatRowRank, formatRowValue, formatRowKindSpecific, metricReportKindSpecificColumnLabel } from "./reportRowDisplay";

type Props = {
  metric: MetricInfo;
  rows: MetricReportRow[];
};

function RowBody({ metric, row, showRank, kindSpecificLabel }: {
  metric: MetricInfo;
  row: MetricReportRow;
  showRank: boolean;
  kindSpecificLabel: string | null;
}) {
  const rank = formatRowRank(row, metric);
  const value = formatRowValue(row, metric);
  const kindSpecific = formatRowKindSpecific(row, metric);

  return (
    <>
      {showRank && <span className="text-text-muted text-sm">{rank}</span>}
      <div className="flex items-center gap-2">
        <span className="font-medium text-text-primary">{row.playerName}</span>
        {row.archived && (
          <Badge variant="neutral" size="sm">
            Archived
          </Badge>
        )}
      </div>
      <span className="text-text-primary" title={value.title}>
        {value.text}
      </span>
      {kindSpecificLabel && (
        <span className="text-text-secondary text-sm">{kindSpecific ?? "—"}</span>
      )}
    </>
  );
}

/**
 * The member roster table (#190) — columns adapt to the metric's type and
 * summary kind: rank is hidden for BOOLEAN metrics (see `reportRowDisplay`),
 * and the fourth "kind-specific" column (share of total / vs. average) only
 * appears for SUM/AVERAGE. Dual mobile-card / desktop-table layout matches
 * the platform Access Request queue's established pattern.
 */
export function MetricReportTable({ metric, rows }: Props) {
  const showRank = metric.type === Metric_Type.NUMERIC;
  const kindSpecificLabel = metricReportKindSpecificColumnLabel(metric.summaryKind);

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted" data-testid="report-no-rows">
        <p>No members match this filter or search.</p>
      </div>
    );
  }

  return (
    <section>
      <div className="md:hidden space-y-3">
        {rows.map((row) => (
          <article
            key={row.allianceMemberId}
            className="rounded-lg border border-border bg-surface p-4 space-y-2"
            data-testid={`report-row-card-${row.allianceMemberId}`}
          >
            <RowBody metric={metric} row={row} showRank={showRank} kindSpecificLabel={kindSpecificLabel} />
          </article>
        ))}
      </div>
      <div className="hidden md:block bg-surface rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              {showRank && <th className="text-left py-3 px-4 text-text-muted font-medium">Rank</th>}
              <th className="text-left py-3 px-4 text-text-muted font-medium">Member</th>
              <th className="text-left py-3 px-4 text-text-muted font-medium">Value</th>
              {kindSpecificLabel && (
                <th className="text-left py-3 px-4 text-text-muted font-medium">{kindSpecificLabel}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const rank = formatRowRank(row, metric);
              const value = formatRowValue(row, metric);
              const kindSpecific = formatRowKindSpecific(row, metric);
              return (
                <tr
                  key={row.allianceMemberId}
                  className="border-b border-border last:border-0"
                  data-testid={`report-row-${row.allianceMemberId}`}
                >
                  {showRank && <td className="py-3 px-4 text-text-muted">{rank}</td>}
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-text-primary">{row.playerName}</span>
                      {row.archived && (
                        <Badge variant="neutral" size="sm">
                          Archived
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td className="py-3 px-4 text-text-primary" title={value.title}>
                    {value.text}
                  </td>
                  {kindSpecificLabel && (
                    <td className="py-3 px-4 text-text-secondary">{kindSpecific ?? "—"}</td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
