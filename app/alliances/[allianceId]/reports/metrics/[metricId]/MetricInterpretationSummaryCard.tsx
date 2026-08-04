import { Card } from "@/app/src/components";

type Props = {
  interpretationSummary: string;
};

/**
 * "What This Tells You" (#264 PR4/PR5) — the deterministic one-sentence
 * executive takeaway (`buildMetricInterpretationSummary`), rendered between
 * the coverage card and the chart so the reader has the headline
 * interpretation before looking at the visual, not buried below it.
 */
export function MetricInterpretationSummaryCard({ interpretationSummary }: Props) {
  return (
    <div data-testid="metric-interpretation-summary-card">
      <Card>
        <Card.Header>What This Tells You</Card.Header>
        <Card.Body>
          <p className="text-sm text-text-secondary" data-testid="metric-interpretation-summary">
            {interpretationSummary}
          </p>
        </Card.Body>
      </Card>
    </div>
  );
}
