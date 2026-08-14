"use client";

import { useRouter } from "next/navigation";
import { NO_COMPARISON_PARAM, NO_PRIOR_PERIOD_PARAM } from "./comparePeriodSelection";

export type PeriodOption = {
  id: string;
  name: string;
  active: boolean;
};

type MemberPeriodSelectorProps = {
  allianceId: string;
  memberId: string;
  selectedPeriodId: string;
  /** Must be in the same chronological order `page.tsx` queried them in (`metricPeriodChronologicalOrderBy`) - see `handleChange` below, which relies on array position rather than re-deriving dates client-side. */
  periods: PeriodOption[];
  /** A real period id, `"none"`, or `"no-prior"` - see `handleChange`'s validity-aware reset rules. */
  chosenComparePeriodId: string;
};

export function MemberPeriodSelector({
  allianceId,
  memberId,
  selectedPeriodId,
  periods,
  chosenComparePeriodId,
}: MemberPeriodSelectorProps) {
  const router = useRouter();

  if (periods.length <= 1) {
    return null;
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const periodId = e.target.value;
    if (!periodId) {
      return;
    }

    // `periods` is already in the exact chronological order `page.tsx`
    // queried it in - the same total order `findOlderMetricPeriods` sorts
    // by - so "everything older than the newly chosen primary" is simply
    // "everything after its index," with no need to re-derive dates here.
    const newIndex = periods.findIndex((p) => p.id === periodId);
    const newEligibleIds = new Set(periods.slice(newIndex + 1).map((p) => p.id));

    // Validity-aware stickiness (see comparePeriodSelection.ts's contract):
    // each sentinel/id is retained only while it stays legal for the new
    // primary period. An unconditionally-sticky sentinel is exactly what
    // would let this selector build a URL `resolveComparePeriodSelection`
    // itself rejects with `notFound()` - reserved for hand-edited URLs,
    // never something a leader's own click can produce. Anything that
    // stops being legal is simply omitted; the server canonicalizes it
    // (to the new primary's immediate predecessor, or "no-prior" if none).
    let nextComparePeriodId: string | null;
    if (chosenComparePeriodId === NO_COMPARISON_PARAM && newEligibleIds.size > 0) {
      nextComparePeriodId = NO_COMPARISON_PARAM;
    } else if (chosenComparePeriodId === NO_PRIOR_PERIOD_PARAM && newEligibleIds.size === 0) {
      nextComparePeriodId = NO_PRIOR_PERIOD_PARAM;
    } else if (newEligibleIds.has(chosenComparePeriodId)) {
      nextComparePeriodId = chosenComparePeriodId;
    } else {
      nextComparePeriodId = null;
    }

    const params = new URLSearchParams();
    params.set("periodId", periodId);
    if (nextComparePeriodId !== null) {
      params.set("comparePeriodId", nextComparePeriodId);
    }
    router.replace(`/alliances/${allianceId}/members/${memberId}?${params.toString()}`);
  };

  return (
    <div className="flex items-center gap-2 text-sm text-text-secondary">
      <label htmlFor="period-selector" className="font-medium text-text-primary">
        Evaluation Period:
      </label>
      <select
        id="period-selector"
        value={selectedPeriodId}
        onChange={handleChange}
        className="px-3 py-1.5 rounded-md border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {periods.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} {p.active ? "(Active)" : "(Inactive)"}
          </option>
        ))}
      </select>
    </div>
  );
}
