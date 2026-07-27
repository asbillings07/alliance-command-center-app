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

/** Latest active period by startsAt — mirrors resolveTargetPeriod ordering. */
export function pickSuggestedAlliancePeriod(
  periods: AlliancePeriodOption[],
): AlliancePeriodOption | null {
  if (periods.length === 0) return null;
  return [...periods].sort((a, b) => {
    if (a.startsAt && b.startsAt) {
      const byStart = b.startsAt.localeCompare(a.startsAt);
      if (byStart !== 0) return byStart;
    } else if (a.startsAt) {
      return -1;
    } else if (b.startsAt) {
      return 1;
    }
    return b.name.localeCompare(a.name);
  })[0] ?? null;
}
