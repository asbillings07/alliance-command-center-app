export type AlliancePeriodOption = {
  id: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  metrics: { id: string; name: string }[];
};

export function sortAlliancePeriods(periods: AlliancePeriodOption[]): AlliancePeriodOption[] {
  return [...periods].sort((a, b) => {
    if (a.startsAt && b.startsAt) {
      const byStart = a.startsAt.localeCompare(b.startsAt);
      if (byStart !== 0) return byStart;
    } else if (a.startsAt) {
      return -1;
    } else if (b.startsAt) {
      return 1;
    }
    return a.name.localeCompare(b.name);
  });
}
