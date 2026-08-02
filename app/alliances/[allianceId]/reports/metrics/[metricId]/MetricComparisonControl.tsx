"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, Label } from "@/app/src/components/client";
import type { MetricSummaryComparison } from "@/app/src/lib/reports/getMetricSummaryReport";

type Props = {
  allianceId: string;
  metricId: string;
  comparison: MetricSummaryComparison;
};

/**
 * Resolves the comparison period for a metric report (#190): selects among
 * the read model's `eligiblePeriods`, and surfaces the specific reason a
 * comparison isn't currently showing a change (no eligible period at all,
 * an invalid/stale `comparePeriodId` in the URL, or an eligible period with
 * no recorded data yet). Never silently substitutes a different period than
 * what the URL asked for — `INVALID_COMPARISON_PERIOD` requires an explicit
 * "Use recommended" action from the leader.
 */
export function MetricComparisonControl({ allianceId, metricId, comparison }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const navigate = (comparePeriodId: string | null) => {
    const params = new URLSearchParams(searchParams.toString());
    if (comparePeriodId) {
      params.set("comparePeriodId", comparePeriodId);
    } else {
      params.delete("comparePeriodId");
    }
    startTransition(() => {
      router.push(`/alliances/${allianceId}/reports/metrics/${metricId}?${params.toString()}`);
    });
  };

  if (comparison.status === "NO_ELIGIBLE_PERIOD") {
    return (
      <p className="text-sm text-text-muted" data-testid="comparison-no-eligible-period">
        No comparable prior period is available for this metric yet.
      </p>
    );
  }

  const currentValue =
    comparison.status === "COMPARED" || comparison.status === "NO_DATA_IN_COMPARISON_PERIOD"
      ? comparison.period.id
      : "";

  return (
    <div className="flex flex-col gap-2">
      {comparison.status === "INVALID_COMPARISON_PERIOD" && (
        <p className="text-sm text-warning-light" data-testid="comparison-invalid-banner">
          That comparison period isn&apos;t valid for this metric.
          {comparison.recommended && (
            <button
              type="button"
              className="ml-2 text-primary hover:text-primary-hover underline disabled:opacity-50"
              onClick={() => navigate(comparison.recommended!.id)}
              disabled={isPending}
              data-testid="comparison-use-recommended"
            >
              Use recommended: {comparison.recommended.name}
            </button>
          )}
        </p>
      )}
      {comparison.status === "NO_DATA_IN_COMPARISON_PERIOD" && (
        <p className="text-sm text-text-muted" data-testid="comparison-no-data-banner">
          No results were recorded in {comparison.period.name} to compare against.
        </p>
      )}
      {comparison.eligiblePeriods.length > 0 && (
        <div>
          <Label htmlFor="compare-period-select">Compare against</Label>
          <Select
            id="compare-period-select"
            data-testid="compare-period-select"
            value={currentValue}
            disabled={isPending}
            onChange={(e) => navigate(e.target.value || null)}
          >
            <option value="">Select a comparison period…</option>
            {comparison.eligiblePeriods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name}
              </option>
            ))}
          </Select>
        </div>
      )}
    </div>
  );
}
