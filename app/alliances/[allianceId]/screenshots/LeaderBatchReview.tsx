"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { BatchConfirmation, type BatchDestination } from "./BatchConfirmation";
import { LocalTimestamp } from "./LocalTimestamp";
import { RankingScreenshotDialog } from "./RankingScreenshotDialog";
import { AllianceBatchDialog } from "./AllianceBatchDialog";
import { QaAllianceSettings, type QaAllianceSettingsData } from "./QaAllianceSettings";
import { rankingWindow, reconcileOverlap, resolveRankingChoices, showCurrentDayProgress, type RankingReview, type RosterMember } from "@/app/src/lib/ocr/ranking";
import { allianceRejectionMessage, isAllianceRejection, allianceBatchNotice } from "@/app/src/lib/ocr/allianceEvidence";

type Attempt = { id: string; status: string; createdAt: string; actorName: string; actorRole: string; outcome?: string | null };
type Result = { attempt: Attempt; batchReview: RankingReview; contextChanged: boolean };
type Item = { requestId: string; file: File | null; state: "queued" | "reading" | "ready" | "failed" | "blocked"; error?: string; outcome?: string; attemptId?: string; result?: Result };
type Props = { destination?: BatchDestination; allianceId: string; initial: { contextKey: string; processingConsentId: number | null; allianceName: string; server: string; members: RosterMember[]; attempts: Attempt[] }; synthetic: boolean; qaSettings?: QaAllianceSettingsData | null };
const statusText = { exact: "Exact name candidate", suggested: "Suggested match — confirm the name", ambiguous: "Ambiguous roster name", unmatched: "No roster match", invalid: "Unreadable name or score", archived: "Archived member — review required" };

export function LeaderBatchReview({ allianceId, initial, synthetic, qaSettings, destination }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]); const [week, setWeek] = useState(""); const [captureDate, setCaptureDate] = useState("");
  const [retryFailed, setRetryFailed] = useState(false);
  const [notice, setNotice] = useState<ReturnType<typeof allianceBatchNotice>>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [source, setSource] = useState<{ result: Result; title: string } | null>(null);
  const [sourcePicks, setPicks] = useState<string[]>([]);
  const [excludedSources, setExcludedSources] = useState<string[]>([]); const [reviewed, setReviewed] = useState(false);
  const cancel = useRef(false); const active = useRef(true); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; cancel.current = true; }; }, []);
  const endpoint = `/api/ocr-evaluation?${new URLSearchParams({ allianceId, scope: "batch" })}`;
  const results = items.flatMap(item => item.result ? [item.result] : []);
  const grouped = resolveRankingChoices(reconcileOverlap(items.flatMap((item, sourceIndex) => item.result ? item.result.batchReview.rows.map(row => ({ ...row,
    attemptId: item.result!.attempt.id, source: sourceIndex + 1,
    window: !item.result!.contextChanged ? rankingWindow(item.result!.batchReview.context, week, captureDate) : null })) : []), !!destination), sourcePicks);
  // Preserve exclusions when assigning a date combines overlapping source rows.
  const sourceKeys = (group: (typeof grouped)[number]) =>
    (group.choices.length ? group.choices : group.sources).map(r => r.attemptId + ":" + r.key);
  const excluded = grouped.filter(group => sourceKeys(group).some(key => excludedSources.includes(key)))
    .map(({row}) => row.attemptId + ":" + row.key);
  const minimized = grouped.filter(({ row }) => excluded.includes(`${row.attemptId}:${row.key}`));
  const chosen = grouped.filter(({ row }) => !excluded.includes(`${row.attemptId}:${row.key}`));
  const pending = chosen.filter(({ row, conflict, createMember }) => (row.status !== "exact" && !createMember) || conflict || !row.window);
  const missingDates = results.some(r => !rankingWindow(r.batchReview.context, week, captureDate));
  const unresolvedImages = items.filter(item => item.state !== "ready" || !item.result?.batchReview.rows.length || item.result.contextChanged).length;
  const queued = items.filter(i => i.state === "queued");
  const existing = initial.attempts.filter(a => !items.some(item => item.attemptId === a.id || item.result?.attempt.id === a.id));
  const weekInvalid = !!week && !rankingWindow({ kind: "weekly", label: "Weekly Rank" }, week);

  function invalidate() { setPicks([]); setNotice(null); setReviewed(false); }
  async function read(id: string): Promise<Result> {
    const response = await fetch(`${endpoint}&id=${encodeURIComponent(id)}&kind=result`, { cache: "no-store" });
    const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error || "This scan is unavailable."), { outcome: result.outcome });
    if (!result.batchReview) throw new Error("This is not an alliance ranking capture.");
    return result;
  }
  async function scan() {
    if (busy || !queued.length) return;
    cancel.current = false; setBusy(true); setMessage(""); invalidate();
    let nextItems = items;
    function update(requestId: string, patch: Partial<Item>) {
      nextItems = nextItems.map(item => item.requestId === requestId ? { ...item, ...patch } : item);
      if (active.current) setItems(nextItems);
    }
    for (const item of queued) {
      if (cancel.current || !active.current) break;
      update(item.requestId, { state: "reading" });
      try {
        const form = new FormData(); form.set("screenshot", item.file!, "screenshot"); form.set("requestId", item.requestId);
        form.set("contextKey", initial.contextKey); form.set("processingConsentId", String(initial.processingConsentId)); form.set("retryFailed", String(retryFailed));
        const response = await fetch(endpoint, { method: "POST", body: form }); const attempt = await response.json();
        if (!response.ok) throw Object.assign(new Error(attempt.error || "This screenshot did not complete."), { outcome: attempt.outcome });
        update(item.requestId, { attemptId: attempt.id });
        if (isAllianceRejection(attempt)) {
          update(item.requestId, { file: null, state: "blocked", outcome: attempt.outcome, error: allianceRejectionMessage(attempt.outcome) });
          continue;
        }
        if (attempt.status !== "READY") throw new Error("This attempt failed or is still pending. It was not sent again. Check upload history before starting another scan.");
        const result = await read(attempt.id);
        if (nextItems.some(p => p.requestId !== item.requestId && p.result?.attempt.id === result.attempt.id)) {
          nextItems = nextItems.filter(p => p.requestId !== item.requestId);
          if (active.current) setItems(nextItems);
        } else update(item.requestId, { file: null, state: "ready", result });
      } catch (error) {
        if (isAllianceRejection(error)) {
          update(item.requestId, { file: null, state: "blocked", outcome: error.outcome, error: allianceRejectionMessage(error.outcome) });
        } else {
          update(item.requestId, { file: null, state: "failed", error: error instanceof Error ? error.message : "Scan failed." });
          // Uncertain processing or changed access stops dispatch. A confirmed
          // source rejection only excludes that image; other consented files continue.
          cancel.current = true;
        }
      }
    }
    if (active.current) {
      router.refresh(); setBusy(false); setRetryFailed(false);
      setNotice(allianceBatchNotice(nextItems));
      setMessage(cancel.current ? "Stopped. Completed scans remain below; unstarted images are still queued. No scan is retried automatically."
        : nextItems.some(item => item.state === "blocked") ? "Batch checked. Each blocked screenshot has its own warning. Matching screenshots remain available for review. No scores were saved."
        : nextItems.some(item => item.state === "failed") ? "Remaining scans completed. Earlier failed images still need attention. No scores were saved."
        : "Batch recognition is ready. Review the names, scores and source periods together. No scores were saved.");
    }
  }
  async function reopen(attempt: Attempt) {
    if (busy) return;
    setBusy(true); setMessage(""); setNotice(null);
    let nextItems = items;
    try {
      const result = await read(attempt.id);
      if (!active.current) return;
      nextItems = items.some(p => p.attemptId === attempt.id || p.result?.attempt.id === attempt.id) ? items
        : [...items, { requestId: attempt.id, attemptId: attempt.id, file: null, state: "ready", result }];
      invalidate(); setItems(nextItems);
    } catch (error) {
      if (!active.current) return;
      if (isAllianceRejection(error)) {
        const blocked: Item = { requestId: attempt.id, attemptId: attempt.id, file: null, state: "blocked", outcome: error.outcome, error: allianceRejectionMessage(error.outcome) };
        nextItems = [...items.filter(item => item.attemptId !== attempt.id && item.result?.attempt.id !== attempt.id), blocked];
        invalidate(); setItems(nextItems); setNotice(allianceBatchNotice(nextItems));
        setMessage(blocked.error!);
      } else setMessage(error instanceof Error ? error.message : "Scan unavailable.");
    } finally { if (active.current) setBusy(false); }
  }
  return <div className="space-y-6 sentry-block" data-sentry-block>
    <div className="rounded-xl border border-border bg-surface p-4"><div className="flex flex-wrap items-center gap-3"><Badge variant="info">{synthetic ? "Synthetic test fixture" : "Recognition trial"}</Badge><strong>{destination ? "Review and confirm scores" : "Recognition review"}</strong></div></div>
    {qaSettings && <QaAllianceSettings key={qaSettings.identityVersion} allianceId={allianceId} initial={qaSettings} disabled={busy} />}
    <Card><h2 className="text-lg font-semibold">1. Add your ranking screenshots</h2>
      <p className="mt-2 text-sm font-medium">Capturing for {initial.allianceName} · Server {initial.server}</p>
      <p className="mt-2 text-sm text-text-secondary">Show the selected weekday or Weekly Rank, plus each player’s name, alliance and points.</p>
      <details className="mt-2 text-sm text-text-secondary">
        <summary className="w-fit cursor-pointer rounded py-2 font-medium text-primary-light focus-visible:outline-2 focus-visible:outline-primary">Learn more about screenshot requirements</summary>
        <p className="mt-1">In the game, select Your Alliance to filter the rankings. Each row must show this alliance’s tag or name. Mixed, unreadable or different alliances are blocked.</p>
        <p className="mt-2">An alliance mismatch skips that image. A processing failure or pressing Stop pauses the rest of the batch. Each account can start up to 20 scans per day.</p>
      </details>
      <label htmlFor="ranking-screenshots" className="mt-4 block font-medium">Ranking screenshots</label>
      <p id="ranking-file-limits" className="text-sm text-text-muted">Up to 20 PNG or JPEG images, 2 MB each.</p>
      <input aria-describedby="ranking-file-limits" id="ranking-screenshots" ref={input} type="file" accept="image/png,image/jpeg" multiple disabled={busy} className="mt-2 block w-full min-w-0 rounded-lg border border-border p-2 text-sm focus:outline-2 focus:outline-primary"
        onChange={event => { const files = Array.from(event.target.files ?? []); if (!files.length) return;
          if (files.length + items.length > 20 || files.some(f => f.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(f.type))) { setMessage("Choose up to 20 PNG or JPEG images, each no larger than 2 MB."); event.target.value = ""; return; }
          setItems(previous => [...previous, ...files.map(file => ({ file, requestId: crypto.randomUUID(), state: "queued" as const }))]); setRetryFailed(false); invalidate(); setMessage(""); event.target.value = ""; }} />
      {items.length > 0 && <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item, index) => <li key={item.requestId} aria-label={`Screenshot ${index + 1}`} className="min-w-0 rounded-lg border border-border p-3 text-sm">
        <strong>Screenshot {index + 1}</strong><p className="mt-1 text-text-secondary">{item.state === "ready" ? item.result!.batchReview.context.label : item.state === "reading" ? "Reading…" : item.state === "blocked" ? "Blocked — alliance check" : item.state === "failed" ? "Needs attention" : "Queued"}</p>
        {item.error && <p className="mt-2 break-words text-warning-light">{item.error}</p>}
        {!busy && (item.state === "failed" || item.state === "queued" || item.state === "blocked") && <div className="mt-3"><Button variant="secondary" onClick={() => {setItems(previous => previous.filter(p => p.requestId !== item.requestId)); invalidate();}}>Remove screenshot {index + 1} from review</Button></div>}
        {item.result && <div className="mt-3"><Button variant="secondary" onClick={() => setSource({ result: item.result!, title: `Screenshot ${index + 1}` })}>View screenshot {index + 1}</Button></div>}
      </li>)}</ol>}
      {(initial.attempts.some(a => a.status === "FAILED" && !isAllianceRejection(a)) || items.some(i => i.state === "failed")) && <label className="mt-4 flex items-start gap-3 text-sm text-text-secondary"><input type="checkbox" checked={retryFailed} disabled={busy || !queued.length} onChange={e => setRetryFailed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
        <span>Start a new attempt for failed images I selected again. Earlier failures stay in history. Completed scans are reused.</span></label>}
      <div className="mt-4 flex flex-wrap gap-3"><Button disabled={busy || !queued.length} onClick={scan}>{busy ? "Reading screenshots…" : `Read ${queued.length || "selected"} screenshots`}</Button>
        {busy ? <Button variant="secondary" onClick={() => { cancel.current = true; setMessage("Stopping after the current image. A scan already sent cannot be recalled."); }}>Stop after this image</Button>
          : <Button variant="secondary" disabled={!items.length} onClick={() => { setItems([]); setSource(null); setExcludedSources([]); invalidate(); setMessage("Review cleared. Retained scans remain in upload history."); }}>Clear review</Button>}</div>
    </Card>
    <section aria-labelledby="batch-review-heading"><h2 id="batch-review-heading" className="text-lg font-semibold">2. Review all recognized members</h2>
      <h3 className="mt-4 font-semibold">Scoring dates</h3>
      <p className="mt-2 text-sm text-text-secondary">Choose one scoring week per batch. The dates below update as you select it.</p>
      <div className="my-4 grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Week beginning (Monday)<input id="ranking-calendar-week" type="date" value={week} disabled={busy} aria-invalid={weekInvalid} aria-describedby={weekInvalid ? "ranking-week-error" : undefined} onChange={e => { setWeek(e.target.value); setReviewed(false); setMessage(""); }} className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface p-3 text-base" /></label>
        {results.some(r => r.batchReview.context.kind === "today") && <label className="grid gap-2 text-sm font-medium">Game date shown as Today&apos;s Duel<input type="date" value={captureDate} disabled={busy} onChange={e => { setCaptureDate(e.target.value); setReviewed(false); setMessage(""); }} className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface p-3 text-base" /></label>}</div>
      {weekInvalid && <p id="ranking-week-error" role="alert" className="mb-3 rounded-lg border border-warning p-3 text-sm text-warning-light">Choose a Monday to start the scoring week. Each screenshot keeps its detected weekday.</p>}
      <details className="mb-3 text-sm text-text-secondary">
        <summary className="w-fit cursor-pointer rounded py-2 font-medium text-primary-light focus-visible:outline-2 focus-visible:outline-primary">Learn more about scoring dates and totals</summary>
        <p className="mt-1">A weekday on a ranking identifies its day within the week you choose. Upload order cannot tell you when a screenshot was taken. A visible countdown on today’s duel means the score can still increase.</p>
        <p className="mt-2">Daily scores and Weekly Rank totals are recorded separately. The weekly total already includes the daily scores. It cannot fill in missing days. Review flags conflicting readings for the same day or week. Weekly totals are not checked against the sum of daily scores.</p>
      </details>
      {results.length > 0 && <ul className="mt-3 space-y-1 text-sm">{items.map((item, i) => item.result && (() => { const window = rankingWindow(item.result.batchReview.context, week, captureDate); return <li key={item.requestId}>Screenshot {i + 1} · {item.result.batchReview.context.label}: {window?.startsWith("week:") ? `week beginning ${window.slice(5)}` : window || "Choose the correct week or game date above"}</li>; })())}</ul>}
      {items.map((item, i) => item.result && (() => { const r = item.result; return <div key={r.attempt.id} className="mb-3 text-sm">
        {(r.batchReview.context.kind === "missing" || !r.batchReview.rows.length) && <p className="rounded-lg border border-warning p-3 text-warning-light">Screenshot {i + 1}: {r.batchReview.context.kind === "missing" ? "The selected weekday or Weekly Rank could not be verified. Upload an uncropped image with the selection visible." : "No complete name-and-score rows could be read. Check the image and use a clearer capture."}</p>}
        {r.contextChanged && <p className="rounded-lg border border-warning p-3 text-warning-light">The roster or access changed since screenshot {i + 1}. This is historical evidence; refresh and start a new review before using it.</p>}
        {showCurrentDayProgress(r.batchReview, rankingWindow(r.batchReview.context, week, captureDate)) && <p className="rounded-lg border border-border p-3 text-primary-light">Screenshot {i + 1}: the current game day is in progress · {r.batchReview.countdown} remaining. These scores can increase.</p>}
      </div>; })())}
      <p className="mb-3 text-sm text-text-muted">{grouped.length} unique rows · {grouped.reduce((n, g) => n + g.duplicates, 0)} overlapping rows · {pending.length} rows need review · {excluded.length} excluded{unresolvedImages ? ` · ${unresolvedImages} screenshots need attention` : ""}</p>
      {grouped.length === 0 ? <Card><p className="text-text-secondary">Recognized names and scores will appear together here.</p></Card> : <ol className="grid gap-3 lg:grid-cols-2">{[...chosen, ...minimized].map(group => {
        const { row, sources, conflict, createMember, choices } = group;
        const key = `${row.attemptId}:${row.key}`; const skip = excluded.includes(key);
        const name = row.sourceName || "Unreadable name";
        const windowLabel = row.window?.startsWith("week:") ? `Week of ${row.window.slice(5)}` : row.window;
        return <li key={key} className={`min-w-0 self-start rounded-xl border border-border bg-surface ${skip ? "px-3 py-2" : "p-4"}`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0"><strong className="break-words">{name}</strong>{skip && <span className="ml-2 text-sm text-text-secondary">Excluded · {windowLabel ?? `Screenshot ${row.source}`}</span>}</div>
            {!skip && <strong className="tabular-nums">{row.value?.toLocaleString("en-US") ?? row.sourceValue}</strong>}
            <Button variant="secondary" onClick={() => {
              const keys = sourceKeys(group);
              setExcludedSources(old => skip ? old.filter(id => !keys.includes(id)) : [...new Set([...old, ...keys])]);
              setReviewed(false);
            }}>{skip ? "Include in review" : "Exclude from review"}</Button>
          </div>
          {!skip && <>
          <p className="mt-2 text-sm text-text-secondary">{row.window?.startsWith("week:") ? `Weekly total · week of ${row.window.slice(5)}` : row.window ? `Daily score · ${row.window}` : <>Calendar context needs review — <a href="#ranking-calendar-week" className="text-primary-light underline">choose the scoring date above</a>.</>}</p>
          <p className="mt-2 text-sm text-text-secondary">{createMember ? "New roster member · will be created when you confirm" : statusText[row.status]}{row.status !== "exact" && row.matchedName ? `: ${row.matchedName}` : ""}</p>
          {row.allianceLabel && <p className="mt-1 break-words text-sm text-text-muted">Source alliance: {row.allianceLabel}</p>}
          {choices.length > 0 && <label className="mt-2 block">Conflicting scores for {row.sourceName}
            <select className="block w-full rounded border border-border bg-surface p-2" value={conflict ? "" : key}
              onChange={e => {
                const keys = choices.map(r=>r.attemptId+":"+r.key);
                const selected = e.target.value;
                setPicks(old=>[...old.filter(id=>!keys.includes(id)),...(selected ? [selected] : [])]);
                setExcludedSources(old=>old.filter(id=>!keys.includes(id)));
                setReviewed(false);
              }}>
              <option value="">Choose a source or exclude this row</option>
              {choices.map(r=><option key={r.attemptId+":"+r.key} value={r.attemptId+":"+r.key}>Screenshot {r.source} · {r.value?.toLocaleString()}</option>)}
            </select></label>}
          {conflict && <p className="mt-2 text-sm text-warning-light">These images show different values for the same member and result window. No value has been chosen automatically.</p>}
          <p className="mt-2 text-xs text-text-muted">Source screenshots: {sources.map(s => s.source).join(", ")}{sources.length > 1 && !conflict ? " · same value shown once" : ""}</p>
          <div className="mt-3 flex flex-wrap gap-3"><Button variant="secondary" onClick={() => setSource({ result: results.find(r => r.attempt.id === row.attemptId)!, title: `Source for ${row.sourceName || "row"}` })}>View source for {row.sourceName || "row"}</Button>
          </div></>}
        </li>;
      })}</ol>}
      {grouped.length > 0 && <div className="mt-4 rounded-lg border border-border p-4 text-sm"><p>Exclude uncertain rows before continuing. You’ll review the changes before saving.</p>
        <div className="mt-4"><Button disabled={busy || missingDates || weekInvalid || pending.length > 0 || unresolvedImages > 0 || !chosen.length} onClick={() => { setReviewed(true); setMessage("Recognition review complete. No member scores or reports were changed."); }}>Finish recognition review</Button></div>
        {reviewed && <><p className="mt-3 text-primary-light">{destination ? "Recognition reviewed" : "Recognition reviewed · No scores saved"}</p>
          {destination && results.some(r => r.batchReview.context.kind === "today") && <p className="mt-2">Today’s Duel is available for progress review. Use the selected Daily Rank or Weekly Rank screen to save scores.</p>}
          {destination && !results.some(r => r.batchReview.context.kind === "today") && <BatchConfirmation destination={destination} daily={chosen.some(g => !g.row.window?.startsWith("week:"))} weekly={chosen.some(g => g.row.window?.startsWith("week:"))}
            selection={{ allianceId, periodId: destination.periodId, week, captureDate, attemptIds: results.map(r => r.attempt.id), excluded, sourcePicks }} />}</>}</div>}
    </section>
    {notice && <AllianceBatchDialog {...notice} allianceName={initial.allianceName} server={initial.server} onClose={() => { setNotice(null); input.current?.focus(); }} />}
    {source && <RankingScreenshotDialog key={source.result.attempt.id}
      imageUrl={`${endpoint}&id=${encodeURIComponent(source.result.attempt.id)}&kind=image`}
      title={source.title} periodLabel={source.result.batchReview.context.label}
      uploadedBy={source.result.attempt.actorName} uploadedAt={source.result.attempt.createdAt}
      onClose={() => setSource(null)} />}
    <p role="status" aria-live="polite" className="break-words text-sm text-text-secondary">{message}</p>
    <section><h2 className="text-lg font-semibold">Ranking upload history</h2><p className="mt-1 text-sm text-text-muted">Latest 20 captures · Times in your timezone. Reopen a scan to review it again.</p>
      <ol className="mt-3 grid gap-3 md:grid-cols-2">{existing.map(attempt => <li key={attempt.id} className="min-w-0 rounded-lg border border-border p-3 text-sm"><p className="break-words">{attempt.actorName} · <LocalTimestamp value={attempt.createdAt} /></p>{isAllianceRejection(attempt) && <p className="mt-2 text-warning-light">{allianceRejectionMessage(attempt.outcome)}</p>}<div className="mt-2"><Button variant="secondary" disabled={busy || attempt.status !== "READY" || items.length >= 20} onClick={() => reopen(attempt)}>{attempt.status === "READY" ? "Add scan to review" : isAllianceRejection(attempt) ? "Blocked — alliance check" : "Failed or pending — not retried"}</Button></div></li>)}</ol>
    </section>
  </div>;
}
