import "server-only";
import { prisma } from "../prisma";

// Caller checks Platform access and evaluation DB isolation before constructing this query.
export function qaManualTimingSummary() {
  return prisma.$queryRaw<Array<{
    state: "open" | "stopped" | "saved"; rows: number | null; samples: number; median: number | null; p90: number | null;
  }>>`
    SELECT CASE WHEN "endedAt" IS NULL THEN 'open' WHEN "savedRows" IS NULL THEN 'stopped' ELSE 'saved' END AS state,
           "savedRows" AS rows, count(*)::int AS samples,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM ("endedAt" - "startedAt"))) FILTER (WHERE "savedRows" IS NOT NULL) AS median,
           percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM ("endedAt" - "startedAt"))) FILTER (WHERE "savedRows" IS NOT NULL) AS p90
    FROM "QaManualTiming" GROUP BY 1, 2 ORDER BY 1, 2`;
}
