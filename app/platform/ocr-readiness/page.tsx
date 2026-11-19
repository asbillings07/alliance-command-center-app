import Link from "next/link";
import { LocalTimestamp } from "@/app/alliances/[allianceId]/screenshots/LocalTimestamp";
import { getOcrReadiness } from "@/app/src/lib/platform/ocrReadiness";

const criteria = [
  ["Usable imports", "Count user-confirmed imports, including corrections, among settled journeys. Keep failed, abandoned and open work distinct. Final confirmations are not yet recorded."],
  ["Silent critical errors", "Check player identity, alliance, reporting period and score against a consented human-reviewed sample. Audited counts and unresolved findings are unavailable."],
  ["Time saved", "Compare median and 90th-percentile start-to-confirm times for comparable OCR and manual tasks. Neither timing sample is available."],
  ["Coverage and repeat use", "Track supported screenshot types, distinct alliances and later-week returns. Daily sign-ins, useful task returns and preference over spreadsheets still need separate evidence."],
  ["Review and manual fallback", "Verify a person can correct and confirm a saved result or finish by hand. The protected screenshot flow currently ends at recognition review."],
  ["Economics and demand", "Calculate cost per confirmed import including retries, failures and support. Invoice costs, confirmed imports and commitments at a specific price are unavailable."],
] as const;

export default async function OcrReadinessPage() {
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
    <section aria-labelledby="diagnostics" className="rounded-lg border border-border bg-surface p-4">
      <h3 id="diagnostics" className="text-lg font-semibold">QA scan activity</h3>
      <p className="mt-1 text-sm text-text-secondary">All {data.attempts} reserved scan attempts in the isolated evaluation. A batch can contain several scans. Registration of a retry preserves the original attempt.</p>
      {data.firstAt && data.lastAt && <p className="mt-2 text-sm text-text-secondary">First scan <LocalTimestamp value={data.firstAt.toISOString()} /> · Latest scan <LocalTimestamp value={data.lastAt.toISOString()} /></p>}
      <dl className="my-4 grid grid-cols-2 gap-4 md:grid-cols-5">
        {counts.map(([label, value]) => <div key={label}><dt className="text-sm text-text-secondary">{label}</dt><dd className="text-xl font-semibold tabular-nums">{value}</dd></div>)}
      </dl>
      <p className="text-sm text-text-secondary">QA allowance reserved: {data.reservedMicros === null ? "Unavailable" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(data.reservedMicros / 1_000_000)}. Actual invoiced cost is unavailable.</p>
    </section>
  </article>;
}
