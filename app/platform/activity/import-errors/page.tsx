import Link from "next/link";
import { LocalTimestamp } from "@/app/alliances/[allianceId]/screenshots/LocalTimestamp";
import { activityPeriods, parseActivityPeriod } from "@/app/src/lib/platform/activityPeriod";
import { getImportLog, type MethodFilter } from "@/app/src/lib/platform/importErrors";
import { wordSnapshotAvailable } from "@/app/src/lib/platform/qaWordSnapshot";
import { ErrorList } from "./ErrorList";

export default async function ImportErrorsPage({ searchParams }: {
  searchParams: Promise<{ method?: string; period?: string; alliance?: string; page?: string; view?: string; activity?: string }>;
}) {
  const params = await searchParams;
  const method: MethodFilter = params.method === "spreadsheet" || params.method === "screenshot" ? params.method : "all";
  const period = parseActivityPeriod(params.period);
  const alliance = typeof params.alliance === "string" ? params.alliance.trim().slice(0, 160) : "";
  const parsed = Number(params.page);
  const page = Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 100000 ? parsed : 0;
  const snapshot = params.view === "word";
  const activity = params.activity === "all" ? "all" : "errors";
  const data = await getImportLog({ method, period, alliance, page, snapshot, activity });
  const href = (n: number) => "?" + new URLSearchParams({ period, method, alliance, activity, page: String(n), ...(snapshot ? { view: "word" } : {}) });
  const field = "mt-1 block w-full rounded border border-border bg-surface px-3 py-2";
  return <article className="mx-auto max-w-4xl space-y-5">
    {wordSnapshotAvailable() && <Link className="text-primary underline" href={snapshot ? "/platform/activity/import-errors" : "/platform/activity/import-errors?view=word"}>
      {snapshot ? "View QA import errors" : "View WORD pilot snapshot"}
    </Link>}
    <h1 className="text-2xl font-bold">{activity === "all" ? "All import activity" : "Import errors"}</h1>
    {data.capturedAt && <p className="rounded border border-border p-3">QA preview · WORD snapshot as of <LocalTimestamp value={data.capturedAt} /></p>}
    <form key={href(0)} className="grid items-end gap-3 rounded-lg border border-border bg-surface p-4 sm:grid-cols-2 lg:grid-cols-5">
      {snapshot && <input type="hidden" name="view" value="word" />}
      <label>Activity<select name="activity" defaultValue={activity} className={field}><option value="errors">Errors only</option><option value="all">All import activity</option></select></label>
      <label>Date range<select name="period" defaultValue={period} className={field}>{Object.entries(activityPeriods).map(([k,v]) => <option key={k} value={k}>{v.label}</option>)}</select></label>
      <label>Import method<select name="method" defaultValue={method} className={field}><option value="all">All imports</option><option value="screenshot">Screenshots</option><option value="spreadsheet">Spreadsheets</option></select></label>
      <label>Alliance name<input name="alliance" className={field} maxLength={160} placeholder="All alliances" defaultValue={alliance} /></label>
      <button className="rounded bg-primary px-4 py-2 font-semibold text-white">Apply filters</button>
    </form>
    <details className="text-sm text-text-secondary"><summary className="cursor-pointer">What is recorded?</summary>
      <p className="mt-2">All import activity shows scan attempts, saved screenshot batches, saved spreadsheet scores and roster imports, newest first. Scan times mark the start of each attempt. Scan records include processing failures and alliance checks. Browser reports include problems selecting files, reviewing imports and confirming saves. Browser reports begin with the updated app and depend on a working connection.</p>
      {snapshot && <p>This snapshot contains scan attempts only. Open a scan to see its recorded confirmation summary.</p>}</details>
    {data.rows.length ? <ErrorList rows={data.rows} snapshot={snapshot} /> : <p>{activity === "all" ? "No recorded import activity matches these filters." : "No recorded import errors match these filters."}</p>}
    {(page > 0 || data.more) && <nav aria-label="Import log pages" className="flex gap-4">{page > 0 && <Link href={href(page-1)} className="underline">Previous page</Link>}{data.more && <Link href={href(page+1)} className="underline">Next page</Link>}</nav>}
  </article>;
}
