"use client";

import { useRouter } from "next/navigation";

export type PeriodOption = {
  id: string;
  name: string;
  active: boolean;
};

type MemberPeriodSelectorProps = {
  allianceId: string;
  memberId: string;
  selectedPeriodId: string;
  periods: PeriodOption[];
};

export function MemberPeriodSelector({
  allianceId,
  memberId,
  selectedPeriodId,
  periods,
}: MemberPeriodSelectorProps) {
  const router = useRouter();

  if (periods.length <= 1) {
    return null;
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const periodId = e.target.value;
    if (periodId) {
      router.replace(`/alliances/${allianceId}/members/${memberId}?periodId=${encodeURIComponent(periodId)}`);
    }
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
