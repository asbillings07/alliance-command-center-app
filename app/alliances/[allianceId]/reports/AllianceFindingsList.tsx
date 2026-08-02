import { Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import type { AllianceFinding } from "@/app/src/lib/reports/allianceFindings";
import { FINDING_KIND_BADGE, formatFindingText } from "./allianceFindingsDisplay";

type Props = {
  allianceId: string;
  periodId: string;
  comparePeriodId?: string;
  findings: AllianceFinding[];
};

/**
 * Deterministic "needs attention" findings (#264 PR2) — sits between the
 * at-a-glance cards and the per-metric performance cards, per the
 * recommended information hierarchy in #264. Always renders, even with zero
 * findings: an empty section reads as ambiguous ("is this broken, or is
 * everything fine?"), so a genuinely healthy period says so explicitly
 * instead of just omitting the section.
 */
export function AllianceFindingsList({ allianceId, periodId, comparePeriodId, findings }: Props) {
  const href = (metricId: string) =>
    `/alliances/${allianceId}/reports/metrics/${metricId}?periodId=${periodId}${
      comparePeriodId ? `&comparePeriodId=${comparePeriodId}` : ""
    }`;

  return (
    <div data-testid="alliance-findings-list">
    <Card>
      <Card.Body>
        <h2 className="text-base font-semibold text-text-primary mb-3">
          Needs attention{findings.length > 0 ? ` (${findings.length})` : ""}
        </h2>
        {findings.length === 0 ? (
          <p className="text-sm text-text-secondary" data-testid="alliance-findings-empty">
            No metrics need attention this period.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {findings.map((finding) => {
              const badge = FINDING_KIND_BADGE[finding.kind];
              // `metricId-kind` is a stable, unique key: `computeAllianceFindings`
              // never emits more than one finding of the same kind for a given
              // metric, so unlike an index-based key this never remounts an
              // unrelated row when findings are added/removed elsewhere in the
              // list, and unlike a kind-only id it stays unique when multiple
              // metrics share the same finding kind.
              const testId = `alliance-finding-${finding.metricId}-${finding.kind}`;
              return (
                <li
                  key={testId}
                  className="flex flex-wrap items-start gap-2"
                  data-testid={testId}
                >
                  <Badge variant={badge.variant} size="sm">
                    {badge.label}
                  </Badge>
                  <Button href={href(finding.metricId)} variant="link" size="sm">
                    {formatFindingText(finding)}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </Card.Body>
    </Card>
    </div>
  );
}
