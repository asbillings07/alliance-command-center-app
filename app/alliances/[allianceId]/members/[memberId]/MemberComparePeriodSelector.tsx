"use client";

import { useRouter } from "next/navigation";
import { NO_COMPARISON_PARAM } from "./comparePeriodSelection";

export type ComparePeriodOption = {
  id: string;
  /** Pre-formatted, guaranteed-distinguishable label - see `formatComparePeriodLabels`. */
  label: string;
};

type MemberComparePeriodSelectorProps = {
  allianceId: string;
  memberId: string;
  selectedPeriodId: string;
  /**
   * A real period id, `"none"`, or `"no-prior"` - always one of these by
   * the time this renders, since `page.tsx` canonicalizes the URL before
   * rendering. `"no-prior"` never occurs while this component is actually
   * rendered (see `options.length === 0` guard below - `"no-prior"` is only
   * ever valid when `eligiblePeriods` is empty, which hides this component
   * entirely), but is accepted here defensively rather than assumed away.
   */
  chosenComparePeriodId: string;
  /** Eligible (strictly older) periods only, already uniquely labeled. */
  options: ComparePeriodOption[];
};

/**
 * The explicit "Compare with" selector (#349), sibling to
 * `MemberPeriodSelector`. Renders nothing when there is nothing eligible to
 * compare against - mirrors `MemberPeriodSelector`'s own `periods.length <=
 * 1` hide rule: there's nothing to decline when nothing was ever offered,
 * matching `resolveComparePeriodSelection`'s rejection of an explicit
 * `"none"` in that same situation.
 */
export function MemberComparePeriodSelector({
  allianceId,
  memberId,
  selectedPeriodId,
  chosenComparePeriodId,
  options,
}: MemberComparePeriodSelectorProps) {
  const router = useRouter();

  if (options.length === 0) {
    return null;
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const comparePeriodId = e.target.value || NO_COMPARISON_PARAM;
    router.replace(
      `/alliances/${allianceId}/members/${memberId}?periodId=${encodeURIComponent(selectedPeriodId)}&comparePeriodId=${encodeURIComponent(comparePeriodId)}`,
    );
  };

  return (
    <div className="flex items-center gap-2 text-sm text-text-secondary">
      <label htmlFor="compare-period-selector" className="font-medium text-text-primary">
        Compare with:
      </label>
      <select
        id="compare-period-selector"
        value={chosenComparePeriodId}
        onChange={handleChange}
        className="px-3 py-1.5 rounded-md border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary"
      >
        <option value={NO_COMPARISON_PARAM}>No comparison</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
