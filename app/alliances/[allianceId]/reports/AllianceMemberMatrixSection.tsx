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
  return (
    <div data-testid="alliance-member-matrix">
      <Card>
        <Card.Body>
          <h2 className="text-base font-semibold text-text-primary mb-4">Members</h2>
          <div className="flex flex-col gap-4">
            <AllianceMemberMatrixControls
              allianceId={allianceId}
              availableColumns={matrix.availableColumns}
              selectedColumnIds={matrix.columns.map((column) => column.id)}
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
