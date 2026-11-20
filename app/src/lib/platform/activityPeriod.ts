export const activityPeriods = {
  "24h": { label: "Last 24 hours", days: 1 },
  "7d": { label: "Last 7 days", days: 7 },
  "30d": { label: "Last 30 days", days: 30 },
  all: { label: "All time", days: null },
} as const;

export type ActivityPeriod = keyof typeof activityPeriods;

export function parseActivityPeriod(value: unknown): ActivityPeriod {
  return typeof value === "string" && Object.hasOwn(activityPeriods, value) ? value as ActivityPeriod : "7d";
}

export function activityStart(period: ActivityPeriod, asOf: Date): Date | null {
  const days = activityPeriods[period].days;
  return days === null ? null : new Date(asOf.getTime() - days * 86_400_000);
}
