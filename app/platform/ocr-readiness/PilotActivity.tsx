import { ErrorList } from "../activity/import-errors/ErrorList";
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
      <ErrorList snapshot={snapshot} rows={attempts.map(a => ({
        key: "scan:" + a.id, when: a.createdAt.toISOString(), alliance: "WORD", account: "WORD pilot account",
        method: "Ranking screenshots", build: a.clientBuild, source: "Scan record",
        reason: pilotError(a.status, a.outcome) ?? (a.scores > 0 ? "Scores confirmed" : a.status === "READY" ? "Ready for review" : "Processing"),
      }))} summaries={attempts.map(a => <span key={a.id} className="block space-y-1">
        <strong>{a.automaticRetry ? "Automatic retry" : a.retry ? "User retry" : a.firstId !== a.id ? "New scan of the same image" : "Initial scan"}</strong>
        <span className="block">{a.scores > 0 ? "Scores confirmed" : a.status === "READY" ? "Ready for review" : a.status === "FAILED" ? "Failed" : "Processing"}</span>
        <span className="block text-sm text-text-secondary">Image {a.firstId.slice(0, 8)} · Scanned <LocalTimestamp value={a.createdAt.toISOString()} /></span>
        <span className="block text-sm text-text-secondary">App version at scan · {a.clientBuild ?? "Not recorded"}</span>
        {a.status === "FAILED" && <span className="block text-sm text-warning-light">{pilotError(a.status, a.outcome)}</span>}
        {a.lastSavedAt && <span className="block text-sm">{a.scores} {a.scores === 1 ? "score" : "scores"} confirmed across all saves · Last saved <LocalTimestamp value={a.lastSavedAt.toISOString()} /></span>}
      </span>)} />}
  </section>;
}
