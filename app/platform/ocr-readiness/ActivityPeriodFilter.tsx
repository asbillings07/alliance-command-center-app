"use client";

import { useRouter } from "next/navigation";
import { activityPeriods, type ActivityPeriod } from "@/app/src/lib/platform/activityPeriod";

export function ActivityPeriodFilter({ period, snapshot }: { period: ActivityPeriod; snapshot: boolean }) {
  const router = useRouter();
  return <label className="flex flex-wrap items-center gap-2 text-sm font-medium">
    Date range
    <select key={period} defaultValue={period} className="min-h-11 rounded-md border border-border bg-surface px-3"
      onChange={event => {
        const query = new URLSearchParams({ period: event.currentTarget.value });
        if (snapshot) query.set("view", "word");
        router.push(`/platform/ocr-readiness?${query}#scan-history`, { scroll: false });
      }}>
      {Object.entries(activityPeriods).map(([value, { label }]) => <option key={value} value={value}>{label}</option>)}
    </select>
  </label>;
}
