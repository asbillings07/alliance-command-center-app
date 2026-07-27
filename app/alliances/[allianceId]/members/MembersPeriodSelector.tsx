"use client";

import { useRouter } from "next/navigation";

export type MembersPeriodOption = {
  id: string;
  name: string;
  active: boolean;
};

type MembersPeriodSelectorProps = {
  allianceId: string;
  currentFilter: string;
  selectedPeriodId?: string;
  periods: MembersPeriodOption[];
};

export function MembersPeriodSelector({
  allianceId,
  currentFilter,
  selectedPeriodId,
  periods,
}: MembersPeriodSelectorProps) {
  const router = useRouter();
  const baseHref = `/alliances/${allianceId}/members?filter=${currentFilter}`;

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const value = event.target.value;
    if (value === "") {
      router.replace(baseHref);
      return;
    }
    router.replace(`${baseHref}&periodId=${encodeURIComponent(value)}`);
  };

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-text-secondary mb-6">
      {selectedPeriodId ? (
        <>
          <span>Evaluation results for:</span>
          <select
            aria-label="Evaluation period"
            value={selectedPeriodId}
            onChange={handleChange}
            className="px-3 py-1.5 rounded-md border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value="">Roster only</option>
            {periods.map((period) => (
              <option key={period.id} value={period.id}>
                {period.name} {period.active ? "(Active)" : "(Inactive)"}
              </option>
            ))}
          </select>
        </>
      ) : (
        <>
          <span>
            Viewing: <span className="font-medium text-text-primary">Roster only</span>
          </span>
          {periods.length > 0 && (
            <select
              aria-label="Evaluation period"
              value=""
              onChange={handleChange}
              className="px-3 py-1.5 rounded-md border border-border bg-surface text-text-primary text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <option value="">Choose a period…</option>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.name} {period.active ? "(Active)" : "(Inactive)"}
                </option>
              ))}
            </select>
          )}
        </>
      )}
    </div>
  );
}
