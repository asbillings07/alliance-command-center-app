import Link from "next/link";
import { LocalTimestamp } from "@/app/alliances/[allianceId]/screenshots/LocalTimestamp";
import { productionPilotConfigured } from "@/app/src/lib/ocr/productionPilot";
import { getProductionPilotCounts, getOcrReadiness } from "@/app/src/lib/platform/ocrReadiness";

import { getQaWordSnapshot } from "@/app/src/lib/platform/qaWordSnapshot";
import { PilotActivity } from "./PilotActivity";

const criteria = [
  ["Usable imports", "Count user-confirmed imports, including corrections, among settled journeys. Keep failed, abandoned and open work distinct. Protected QA confirmations are counted separately below."],
  ["Silent critical errors", "Check player identity, alliance, reporting period and score against a consented human-reviewed sample. Audited counts and unresolved findings are unavailable."],
  ["Time saved", "Compare median and 90th-percentile start-to-confirm times for comparable OCR and manual tasks. Real cohort timings are unavailable. The separate QA baseline below groups manual tasks by the number of rows saved."],
  ["Coverage and repeat use", "Track supported screenshot types, distinct alliances and later-week returns. Daily sign-ins, useful task returns and preference over spreadsheets still need separate evidence."],
  ["Review and manual fallback", "Verify a person can correct and confirm a saved result or finish by hand. Eligible leaders can confirm reviewed ranking scores in isolated QA. Real cohort verification is pending."],
  ["Economics and demand", "Calculate cost per confirmed import including retries, failures and support. Invoice costs, confirmed imports and commitments at a specific price are unavailable."],
] as const;

export default async function OcrReadinessPage({ searchParams }: { searchParams: Promise<{ period?: string; view?: string }> }) {
  const params = await searchParams;
  const sinceFix = params.period !== "all";
  const live = productionPilotConfigured();
  if (live || params.view === "word") {
    const snapshot = live ? null : await getQaWordSnapshot(sinceFix);
    const { scans, retries, failures, saves, confirmedScores, activity } = snapshot ?? await getProductionPilotCounts(sinceFix);
    return <article className="mx-auto max-w-5xl space-y-5">
      <Link href="/platform/overview" className="text-sm text-primary hover:underline">Platform overview</Link>
      <h2 className="text-2xl font-bold">WORD OCR pilot</h2>
      {snapshot && <p className="rounded-lg border border-border bg-surface p-3">QA preview · WORD activity as of <LocalTimestamp value={snapshot.capturedAt} /></p>}
      <p>All-time activity for the selected account in WORD.</p>
      <dl className="grid gap-3 sm:grid-cols-2">
        {([["Uploads", scans - retries], ["Scan attempts", scans], ["Retries included in attempts", retries], ["Failed attempts", failures], ["Confirmed score batches", saves], ["Confirmed scores", confirmedScores]] as const).map(([label, value]) =>
          <div key={label} className="rounded-lg border border-border p-4"><dt>{label}</dt><dd className="text-xl font-semibold">{value}</dd></div>)}
      </dl>
      <PilotActivity attempts={activity} sinceFix={sinceFix} snapshot={!!snapshot} />
      <p>Public beta and paid release: Not enough evidence. A confirmed batch can contain several screenshots. A comparable manual baseline and independent accuracy audit are still needed.</p>
    </article>;
  }
  const data = await getOcrReadiness();
  const counts = [
    ["Initial scans", data.firstAttempts], ["Retry scans", data.retries],
    ["Ready for review", data.ready], ["Failed scans", data.failed], ["Processing", data.processing],
  ] as const;

  return <article className="mx-auto max-w-5xl space-y-6">
    <header>
      <Link href="/platform/overview" className="text-sm text-primary hover:underline">Platform overview</Link>
      <h2 className="mt-3 text-2xl font-bold text-text-primary">OCR release readiness</h2>
      <p className="mt-2 text-text-secondary">The first planned pilot is WORD. The largest evidence gap is the time it takes a member or leader to confirm a correct, saved import.</p>
    </header>
    <section aria-label="Release decisions" className="grid gap-3 md:grid-cols-2">
      {[
        ["Opt-in public beta", "About 100 settled journeys across at least 3 alliances, 90% usable imports, median completion within half the manual time, and no unresolved silent critical errors in an audited sample."],
        ["Public paid release", "95% usable imports sustained across advertised types, continuing audits, repeat use and evidence that customers will pay a price that covers support and processing."],
      ].map(([title, description]) => <div key={title} className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-semibold text-text-primary">{title}</h3>
        <p className="mt-2 font-medium text-text-secondary">Not enough evidence</p>
        <p className="mt-2 text-sm text-text-secondary">{description}</p>
      </div>)}
    </section>
    <section aria-labelledby="criteria" className="space-y-2">
      <h3 id="criteria" className="text-lg font-semibold">Real cohort evidence</h3>
      <p className="text-sm text-text-secondary">The real cohort has no measured journey denominator or observation window yet. QA scans are excluded from both decisions.</p>
      {criteria.map(([name, detail]) => <details key={name} className="rounded-lg border border-border bg-surface px-4">
        <summary className="cursor-pointer py-3 font-medium">{name}</summary>
        <p className="pb-4 text-sm text-text-secondary">{detail}</p>
      </details>)}
    </section>
    <section aria-labelledby="manual-timing" className="space-y-3 rounded-lg border border-border bg-surface p-4">
      <h3 id="manual-timing" className="text-lg font-semibold">QA manual-entry baseline</h3>
      <p className="text-sm text-text-secondary">Elapsed time from choosing Start timed entry to applying a period metric, including edits. Each saved task counts once. Comparing daily VS imports still requires a matching manual task.</p>
      <p className="text-sm">All-time timed tasks · {data.timings.reduce((sum, row) => sum + row.samples, 0)} started · {data.timings.find(row => row.state === "open")?.samples ?? 0} open · {data.timings.find(row => row.state === "stopped")?.samples ?? 0} stopped before save</p>
      {data.timings.some(row => row.state === "saved") ? <ul className="space-y-2">
        {data.timings.filter(row => row.state === "saved").map(row => <li key={row.rows} className="rounded bg-surface-secondary p-3 text-sm">
          <strong>{row.rows} {row.rows === 1 ? "row" : "rows"} per task</strong> · {row.samples} saved · Median {Math.round(row.median ?? 0)}s · 90th percentile {Math.round(row.p90 ?? 0)}s
        </li>)}
      </ul> : <p className="text-sm text-text-secondary">No timed manual entries have been saved.</p>}
    </section>
    <section aria-labelledby="diagnostics" className="rounded-lg border border-border bg-surface p-4">
      <h3 id="diagnostics" className="text-lg font-semibold">QA scan activity</h3>
      <p className="mt-1 text-sm text-text-secondary">All {data.attempts} reserved scan attempts in the isolated evaluation. A batch can contain several scans. Registration of a retry preserves the original attempt.</p>
      {data.firstAt && data.lastAt && <p className="mt-2 text-sm text-text-secondary">First scan <LocalTimestamp value={data.firstAt.toISOString()} /> · Latest scan <LocalTimestamp value={data.lastAt.toISOString()} /></p>}
      <p className="mt-2 text-sm">Confirmed QA score batches: {data.confirmedBatches}</p>
      <dl className="my-4 grid grid-cols-2 gap-4 md:grid-cols-5">
        {counts.map(([label, value]) => <div key={label}><dt className="text-sm text-text-secondary">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      <p className="text-sm text-text-secondary">Shared OCR allowance reserved: {data.reservedMicros === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(data.reservedMicros / 1_000_000)}. Actual invoiced cost is unavailable.</p>
    </section>
  </article>;
}
