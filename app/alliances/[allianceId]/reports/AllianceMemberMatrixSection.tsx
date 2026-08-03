import { Card } from "@/app/src/components";
import type { AllianceMemberMetricMatrix } from "@/app/src/lib/reports/allianceMemberMatrix";
import { AllianceMemberMatrixControls } from "./AllianceMemberMatrixControls";
import { AllianceMemberMatrixTable } from "./AllianceMemberMatrixTable";

type Props = {
  allianceId: string;
  periodId: string;
  comparePeriodId?: string;
  matrix: AllianceMemberMetricMatrix;
};

/**
 * Member-by-metric matrix section (#264 PR3) — the report's third
 * information tier: the at-a-glance cards answer "how is the alliance
 * doing," findings answer "what needs my attention," and this answers "how
 * is each member doing across the metrics I care about right now."
 */
export function AllianceMemberMatrixSection({ allianceId, periodId, comparePeriodId, matrix }: Props) {
  const selectedColumnIds = matrix.columns.map((column) => column.id);
  // The controls keep their own local/uncontrolled state (checked columns,
  // sort value, and the search/filter/direction inputs' `defaultValue`) so
  // typing/clicking feels instant, but the server is the source of truth
  // (it clamps columns to the 6-column max, falls back invalid sorts to
  // name, and normalizes filter/search). Next.js preserves this client
  // component's instance across same-route navigations, so without a key
  // tied to everything the server actually resolved, the controls could
  // keep showing a stale value after a clamp/normalization or a
  // back/forward navigation to a different URL. Keying on every
  // server-resolved field forces a remount (and fresh local/default state)
  // whenever any of them change.
  const controlsKey = [
    selectedColumnIds.join(","),
    matrix.sort.kind === "name" ? "name" : matrix.sort.metricId,
    matrix.sort.direction,
    matrix.filter,
    matrix.search,
  ].join("|");

  return (
    <div data-testid="alliance-member-matrix">
      <Card>
        <Card.Body>
          <h2 className="text-base font-semibold text-text-primary mb-4">Members</h2>
          <div className="flex flex-col gap-4">
            <AllianceMemberMatrixControls
              key={controlsKey}
              allianceId={allianceId}
              availableColumns={matrix.availableColumns}
              selectedColumnIds={selectedColumnIds}
              sort={matrix.sort}
              filter={matrix.filter}
              search={matrix.search}
              page={matrix.pagination.page}
              pageSize={matrix.pagination.pageSize}
              totalRowCount={matrix.pagination.totalRowCount}
            />
            <AllianceMemberMatrixTable
              allianceId={allianceId}
              periodId={periodId}
              comparePeriodId={comparePeriodId}
              matrix={matrix}
            />
          </div>
        </Card.Body>
      </Card>
    </div>
  );
}
