import { ActivityPeriodFilter } from "./ActivityPeriodFilter";
import type { ActivityPeriod } from "@/app/src/lib/platform/activityPeriod";
import { LocalTimestamp } from "@/app/alliances/[allianceId]/screenshots/LocalTimestamp";
import { pilotError, type pilotActivityQuery } from "@/app/src/lib/platform/ocrPilotActivity";

type Props = { attempts: Awaited<ReturnType<typeof pilotActivityQuery>>; period: ActivityPeriod; snapshot: boolean };

export function PilotActivity({ attempts, period, snapshot }: Props) {
  return <section id="scan-history" aria-labelledby="scan-history-title" className="space-y-3 rounded-lg border border-border bg-surface p-4">
    <h3 id="scan-history-title" className="text-lg font-semibold">Scan and confirmation history</h3>
    <ActivityPeriodFilter period={period} snapshot={snapshot} />
    <p className="text-sm text-text-secondary">Latest 20 recorded attempts by scan or confirmation time. Reopening a scan does not create an attempt. Errors before a scan starts are outside this history.</p>
    {attempts.length === 0 ? <p>No scan attempts or score confirmations recorded in this period.</p> :
      <ol className="divide-y divide-border">{attempts.map(a => {
        const state = a.scores > 0 ? "Scores confirmed" : a.status === "READY" ? "Ready for review" : a.status === "FAILED" ? "Failed" : "Processing";
        const reason = pilotError(a.status, a.outcome);
        return <li key={a.id} className="space-y-1 py-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <strong>{a.automaticRetry ? "Automatic retry" : a.retry ? "User retry" : a.firstId !== a.id ? "New scan of the same image" : "Initial scan"}</strong>
            <span className={reason ? "font-medium text-warning-light" : "font-medium"}>{state}</span>
          </div>
          <p className="text-sm text-text-secondary">Image {a.firstId.slice(0, 8)} · Scanned <LocalTimestamp value={a.createdAt.toISOString()} /></p>
          <p className="text-sm text-text-secondary">App version at scan · {a.clientBuild ?? "Not recorded"}</p>
          {reason && <p className="text-sm">{reason}</p>}
          {a.lastSavedAt && <p className="text-sm">{a.scores} {a.scores === 1 ? "score" : "scores"} confirmed across all saves · Last saved <LocalTimestamp value={a.lastSavedAt.toISOString()} /></p>}
        </li>;
      })}</ol>}
  </section>;
}
