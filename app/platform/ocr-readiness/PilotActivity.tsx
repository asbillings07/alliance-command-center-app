import Link from "next/link";
import { LocalTimestamp } from "@/app/alliances/[allianceId]/screenshots/LocalTimestamp";
import { pilotError, thursdayFixLiveAt, type pilotActivityQuery } from "@/app/src/lib/platform/ocrPilotActivity";

type Props = { attempts: Awaited<ReturnType<typeof pilotActivityQuery>>; sinceFix: boolean };

export function PilotActivity({ attempts, sinceFix }: Props) {
  return <section id="scan-history" aria-labelledby="scan-history-title" className="space-y-3 rounded-lg border border-border bg-surface p-4">
    <h3 id="scan-history-title" className="text-lg font-semibold">Scan and confirmation history</h3>
    <nav aria-label="Activity period" className="flex flex-wrap gap-2">
      {([["Since Thursday fix", true], ["All time", false]] as const).map(([label, recent]) =>
        <Link key={label} aria-current={recent === sinceFix ? "page" : undefined}
          className="rounded-md border border-border px-3 py-2 text-sm aria-[current=page]:border-primary aria-[current=page]:font-semibold"
          href={recent ? "/platform/ocr-readiness#scan-history" : "/platform/ocr-readiness?period=all#scan-history"}>{label}</Link>)}
    </nav>
    <p className="text-sm text-text-secondary">Latest 20 recorded attempts by scan or confirmation time{sinceFix && <> since <LocalTimestamp value={thursdayFixLiveAt} /></>}. Reopening a scan does not create an attempt. Errors before a scan starts are outside this history.</p>
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
          {reason && <p className="text-sm">{reason}</p>}
          {a.lastSavedAt && <p className="text-sm">{a.scores} {a.scores === 1 ? "score" : "scores"} confirmed · Last saved <LocalTimestamp value={a.lastSavedAt.toISOString()} /></p>}
        </li>;
      })}</ol>}
  </section>;
}
