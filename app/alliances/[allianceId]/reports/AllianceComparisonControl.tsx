"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, Label } from "@/app/src/components/client";
import type { AllianceComparisonSelection } from "@/app/src/lib/reports/getAlliancePerformanceReport";

type Props = {
  allianceId: string;
  comparisonSelection: AllianceComparisonSelection;
};

/**
 * Resolves the *one shared* comparison period for the whole alliance
 * overview (#264) — every metric card then honestly reports its own
 * relationship to that single period (COMPARED, not attached, inactive, no
 * data), rather than each metric silently picking a different baseline.
 * Structurally the same interaction pattern as the per-metric
 * `MetricComparisonControl` (#190), but resolved once here instead of once
 * per metric.
 */
export function AllianceComparisonControl({ allianceId, comparisonSelection }: Props) {
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
      router.push(`/alliances/${allianceId}/reports?${params.toString()}`);
    });
  };

  if (comparisonSelection.status === "NO_ELIGIBLE_PERIOD") {
    return (
      <p className="text-sm text-text-muted" data-testid="alliance-comparison-no-eligible-period">
        No comparable prior period is available for this period yet.
      </p>
    );
  }

  const currentValue = comparisonSelection.status === "RESOLVED" ? comparisonSelection.period.id : "";

  return (
    <div className="flex flex-col gap-2">
      {comparisonSelection.status === "INVALID_COMPARISON_PERIOD" && (
        <p className="text-sm text-warning-light" data-testid="alliance-comparison-invalid-banner">
          That comparison period isn&apos;t valid for this period.
          {comparisonSelection.recommended && (
            <button
              type="button"
              className="ml-2 text-primary hover:text-primary-hover underline disabled:opacity-50"
              onClick={() => navigate(comparisonSelection.recommended!.id)}
              disabled={isPending}
              data-testid="alliance-comparison-use-recommended"
            >
              Use recommended: {comparisonSelection.recommended.name}
            </button>
          )}
        </p>
      )}
      {comparisonSelection.eligiblePeriods.length > 0 && (
        <div>
          <Label htmlFor="alliance-compare-period-select">Compare against</Label>
          <Select
            id="alliance-compare-period-select"
            data-testid="alliance-compare-period-select"
            value={currentValue}
            disabled={isPending}
            onChange={(e) => navigate(e.target.value || null)}
          >
            <option value="">Select a comparison period…</option>
            {comparisonSelection.eligiblePeriods.map((period) => (
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
