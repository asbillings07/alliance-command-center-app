"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select, Label } from "@/app/src/components/client";

export type AlliancePeriodSelectOption = {
  id: string;
  name: string;
  active: boolean;
};

type Props = {
  allianceId: string;
  periodOptions: AlliancePeriodSelectOption[];
  selectedPeriodId: string;
};

function optionLabel(option: AlliancePeriodSelectOption): string {
  return option.active ? option.name : `${option.name} (archived period)`;
}

/**
 * Switches the alliance performance report's selected period (#264).
 * Alliance-wide, not scoped to any single metric — unlike
 * `MetricReportPeriodSelect` (#190), every option here is just every
 * evaluation period the alliance has ever configured, since a period a
 * given metric was never attached to is still meaningful at this level
 * (other metrics may have been). Changing period clears `comparePeriodId`
 * — a comparison choice is only meaningful relative to the period it was
 * set on.
 */
export function AlliancePeriodSelect({ allianceId, periodOptions, selectedPeriodId }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleChange = (periodId: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("periodId", periodId);
    params.delete("comparePeriodId");
    startTransition(() => {
      router.push(`/alliances/${allianceId}/reports?${params.toString()}`);
    });
  };

  return (
    <div>
      <Label htmlFor="alliance-report-period-select">Period</Label>
      <Select
        id="alliance-report-period-select"
        data-testid="alliance-report-period-select"
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
