import Link from "next/link";
import { Badge } from "@/app/src/components";
import type { AllianceMemberMetricMatrix } from "@/app/src/lib/reports/allianceMemberMatrix";
import { attachmentStatusBadge } from "./allianceReportDisplay";
import { formatMatrixCell } from "./allianceMemberMatrixDisplay";

type Props = {
  allianceId: string;
  periodId: string;
  comparePeriodId?: string;
  matrix: AllianceMemberMetricMatrix;
};

/**
 * The member-by-metric grid (#264 PR3). Single-period values only — no
 * comparison-period values or per-cell diffs, per the PR3 decision; the
 * report's own cards/findings are where comparison is interpreted.
 *
 * Dual mobile-card / desktop-table layout matches `MetricReportTable`'s
 * established pattern. The desktop table's member-name column is sticky so
 * it stays visible while scrolling horizontally through up to
 * `MATRIX_MAX_COLUMNS` metric columns.
 */
export function AllianceMemberMatrixTable({ allianceId, periodId, comparePeriodId, matrix }: Props) {
  const { columns, rows } = matrix;

  if (rows.length === 0) {
    return (
      <div className="text-center py-12 text-text-muted" data-testid="matrix-no-rows">
        <p>No members match this filter or search.</p>
      </div>
    );
  }

  const metricHref = (metricId: string) =>
    `/alliances/${allianceId}/reports/metrics/${metricId}?periodId=${periodId}${
      comparePeriodId ? `&comparePeriodId=${comparePeriodId}` : ""
    }`;

  return (
    <section>
      <div className="md:hidden space-y-3">
        {rows.map((row) => (
          <article
            key={row.allianceMemberId}
            className="rounded-lg border border-border bg-surface p-4 space-y-3"
            data-testid={`matrix-row-card-${row.allianceMemberId}`}
          >
            <div className="flex items-center gap-2">
              <span className="font-medium text-text-primary">{row.playerName}</span>
              {row.archived && (
                <Badge variant="neutral" size="sm">
                  Archived
                </Badge>
              )}
            </div>
            <dl className="grid grid-cols-2 gap-x-3 gap-y-2 text-sm">
              {columns.map((column, index) => {
                const display = formatMatrixCell(row.cells[index]!, column);
                return (
                  <div key={column.id}>
                    <dt className="text-text-muted text-xs">{column.name}</dt>
                    <dd className="text-text-primary" title={display.title}>
                      {display.text}
                    </dd>
                  </div>
                );
              })}
            </dl>
          </article>
        ))}
      </div>

      <div className="hidden md:block bg-surface rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-text-muted font-medium sticky left-0 bg-surface z-10">
                Member
              </th>
              {columns.map((column) => {
                const badge = attachmentStatusBadge(column.attachmentStatus);
                return (
                  <th key={column.id} className="text-left py-3 px-4 text-text-muted font-medium whitespace-nowrap">
                    <Link href={metricHref(column.id)} className="hover:underline text-text-secondary">
                      {column.name}
                    </Link>
                    {badge && (
                      <Badge variant={badge.variant} size="sm" className="ml-2">
                        {badge.label}
                      </Badge>
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr
                key={row.allianceMemberId}
                className="border-b border-border last:border-0"
                data-testid={`matrix-row-${row.allianceMemberId}`}
              >
                <td className="py-3 px-4 sticky left-0 bg-surface">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-text-primary">{row.playerName}</span>
                    {row.archived && (
                      <Badge variant="neutral" size="sm">
                        Archived
                      </Badge>
                    )}
                  </div>
                </td>
                {columns.map((column, index) => {
                  const display = formatMatrixCell(row.cells[index]!, column);
                  return (
                    <td
                      key={column.id}
                      className="py-3 px-4 text-text-primary"
                      title={display.title}
                      data-testid={`matrix-cell-${row.allianceMemberId}-${column.id}`}
                    >
                      {display.text}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
