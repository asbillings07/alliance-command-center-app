"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, Label } from "@/app/src/components/client";

export type PeriodSelectOption = {
  id: string;
  name: string;
  periodActive: boolean;
  attachmentActive: boolean;
  /** True only for a synthetic option representing the currently-selected period when it isn't in the metric's normal attachment history (e.g. a NOT_ATTACHED period reached via a direct URL). */
  notAttached?: boolean;
};

type Props = {
  allianceId: string;
  metricId: string;
  periodOptions: PeriodSelectOption[];
  selectedPeriodId: string;
};

function optionLabel(option: PeriodSelectOption): string {
  if (option.notAttached) return `${option.name} (not attached)`;
  if (!option.periodActive) return `${option.name} (archived period)`;
  if (!option.attachmentActive) return `${option.name} (inactive)`;
  return option.name;
}

/**
 * Switches the report's selected period (#190). Changing period clears
 * `comparePeriodId` and `page` — a comparison choice and roster page
 * position are meaningful only relative to the period they were set on —
 * but preserves the roster's sort/filter/search preferences, which are
 * period-independent display choices.
 */
export function MetricReportPeriodSelect({ allianceId, metricId, periodOptions, selectedPeriodId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleChange = (periodId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("periodId", periodId);
    params.delete("comparePeriodId");
    params.delete("page");
    startTransition(() => {
      router.push(`/alliances/${allianceId}/reports/metrics/${metricId}?${params.toString()}`);
    });
  };

  return (
    <div>
      <Label htmlFor="report-period-select">Period</Label>
      <Select
        id="report-period-select"
        data-testid="report-period-select"
        value={selectedPeriodId}
        disabled={isPending}
        onChange={(e) => handleChange(e.target.value)}
      >
        {periodOptions.map((option) => (
          <option key={option.id} value={option.id}>
            {optionLabel(option)}
          </option>
        ))}
      </Select>
    </div>
  );
}
