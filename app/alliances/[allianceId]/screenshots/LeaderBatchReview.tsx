"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card } from "@/app/src/components";
import { Button, ConfirmDialog } from "@/app/src/components/client";
import { LocalTimestamp } from "./LocalTimestamp";
import { RankingScreenshotDialog } from "./RankingScreenshotDialog";
import { AllianceBatchDialog } from "./AllianceBatchDialog";
import { QaAllianceSettings, type QaAllianceSettingsData } from "./QaAllianceSettings";
import { rankingWindow, reconcileOverlap, showCurrentDayProgress, type RankingReview, type RosterMember } from "@/app/src/lib/ocr/ranking";
import { allianceRejectionMessage, isAllianceRejection, allianceBatchNotice } from "@/app/src/lib/ocr/allianceEvidence";

type Attempt = { id: string; status: string; createdAt: string; actorName: string; actorRole: string; outcome?: string | null };
type Result = { attempt: Attempt; batchReview: RankingReview; contextChanged: boolean };
type Item = { requestId: string; file: File | null; state: "queued" | "reading" | "ready" | "failed" | "blocked"; error?: string; outcome?: string; attemptId?: string; result?: Result };
type Props = { allianceId: string; initial: { contextKey: string; allianceName: string; server: string; members: RosterMember[]; attempts: Attempt[] }; synthetic: boolean; qaSettings?: QaAllianceSettingsData | null };
const statusText = { exact: "Exact name candidate", suggested: "Suggested match — confirm the name", ambiguous: "Ambiguous roster name", unmatched: "No roster match", invalid: "Unreadable name or score", archived: "Archived member — review required" };

export function LeaderBatchReview({ allianceId, initial, synthetic, qaSettings }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]); const [week, setWeek] = useState(""); const [captureDate, setCaptureDate] = useState("");
  const [retryFailed, setRetryFailed] = useState(false);
  const [notice, setNotice] = useState<ReturnType<typeof allianceBatchNotice>>(null);
  const [dateConfirmed, setDateConfirmed] = useState(false); const [consent, setConsent] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [source, setSource] = useState<{ result: Result; title: string } | null>(null);
  const [excluded, setExcluded] = useState<string[]>([]); const [reviewed, setReviewed] = useState(false);
  const cancel = useRef(false); const active = useRef(true); const input = useRef<HTMLInputElement>(null);
  useEffect(() => { active.current = true; return () => { active.current = false; cancel.current = true; }; }, []);
  const endpoint = `/api/ocr-evaluation?${new URLSearchParams({ allianceId, scope: "batch" })}`;
  const results = items.flatMap(item => item.result ? [item.result] : []);
  const grouped = reconcileOverlap(items.flatMap((item, sourceIndex) => item.result ? item.result.batchReview.rows.map(row => ({ ...row,
    attemptId: item.result!.attempt.id, source: sourceIndex + 1,
    window: dateConfirmed && !item.result!.contextChanged ? rankingWindow(item.result!.batchReview.context, week, captureDate) : null })) : []));
  const pending = grouped.filter(({ row, conflict }) => !excluded.includes(`${row.attemptId}:${row.key}`) && (row.status !== "exact" || conflict || !row.window));
  const chosen = grouped.filter(({ row }) => !excluded.includes(`${row.attemptId}:${row.key}`));
  const unresolvedImages = items.filter(item => item.state !== "ready" || !item.result?.batchReview.rows.length || item.result.contextChanged).length;
  const queued = items.filter(i => i.state === "queued");
  const existing = initial.attempts.filter(a => !items.some(item => item.attemptId === a.id || item.result?.attempt.id === a.id));
  const weekInvalid = !!week && !rankingWindow({ kind: "weekly", label: "Weekly Rank" }, week);
  const calendarReady = !busy && !weekInvalid && results.length > 0 && results.every(r => !r.contextChanged && rankingWindow(r.batchReview.context, week, captureDate));

  function invalidate() { setNotice(null); setReviewed(false); setDateConfirmed(false); setCalendarOpen(false); setExcluded([]); }
  async function read(id: string): Promise<Result> {
    const response = await fetch(`${endpoint}&id=${encodeURIComponent(id)}&kind=result`, { cache: "no-store" });
    const result = await response.json(); if (!response.ok) throw Object.assign(new Error(result.error || "This scan is unavailable."), { outcome: result.outcome });
    if (!result.batchReview) throw new Error("This is not an alliance ranking capture.");
    return result;
  }
  async function scan() {
    if (busy || !consent || !queued.length) return;
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
        form.set("consent", "true"); form.set("contextKey", initial.contextKey); form.set("retryFailed", String(retryFailed));
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
      router.refresh(); setBusy(false); setConsent(false); setRetryFailed(false);
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
    <div className="rounded-xl border border-border bg-surface p-4"><div className="flex flex-wrap items-center gap-3"><Badge variant="info">{synthetic ? "Synthetic test fixture" : "Recognition trial"}</Badge><strong>Review only · Scores are not saved</strong></div>
      <p className="mt-2 text-sm text-text-secondary">Upload the ranking capture once. Review every recognized member here, without opening individual member pages.</p></div>
    {qaSettings && <QaAllianceSettings key={qaSettings.identityVersion} allianceId={allianceId} initial={qaSettings} disabled={busy} />}
    <Card><h2 className="text-lg font-semibold">1. Add your ranking screenshots</h2>
      <p className="mt-2 text-sm font-medium">Capturing for {initial.allianceName} · Server {initial.server}</p>
      <p className="mt-2 text-sm text-text-secondary">Only this alliance&apos;s screenshots are accepted. Keep the alliance tag or name visible for every row; use Your Alliance in the game to filter rankings. Different, mixed or unreadable alliances are blocked, with no leader override. Reading an image to check its alliance still uses one scan reservation.</p>
      <p className="mt-2 text-sm text-text-secondary">All selected screenshots are checked, including after an alliance mismatch. Processing failures or stopping the batch leave remaining images unprocessed.</p>
      <p className="mt-2 text-sm text-text-secondary">Keep the selected weekday or Weekly Rank visible on every image, with the full names and points. PNG or JPEG, up to 2 MB each. Choose up to 20 images; scans also have a daily account limit.</p>
      <label htmlFor="ranking-screenshots" className="mt-4 block font-medium">Ranking screenshots</label>
      <input id="ranking-screenshots" ref={input} type="file" accept="image/png,image/jpeg" multiple disabled={busy} className="mt-2 block w-full min-w-0 rounded-lg border border-border p-2 text-sm focus:outline-2 focus:outline-primary"
        onChange={event => { const files = Array.from(event.target.files ?? []); if (!files.length) return;
          if (files.length + items.length > 20 || files.some(f => f.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(f.type))) { setMessage("Choose up to 20 PNG or JPEG images, each no larger than 2 MB."); event.target.value = ""; return; }
          setItems(previous => [...previous, ...files.map(file => ({ file, requestId: crypto.randomUUID(), state: "queued" as const }))]); setConsent(false); setRetryFailed(false); invalidate(); setMessage(""); event.target.value = ""; }} />
      {items.length > 0 && <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item, index) => <li key={item.requestId} aria-label={`Screenshot ${index + 1}`} className="min-w-0 rounded-lg border border-border p-3 text-sm">
        <strong>Screenshot {index + 1}</strong><p className="mt-1 text-text-secondary">{item.state === "ready" ? item.result!.batchReview.context.label : item.state === "reading" ? "Reading…" : item.state === "blocked" ? "Blocked — alliance check" : item.state === "failed" ? "Needs attention" : "Queued"}</p>
        {item.error && <p className="mt-2 break-words text-warning-light">{item.error}</p>}
        {!busy && (item.state === "failed" || item.state === "queued" || item.state === "blocked") && <div className="mt-3"><Button variant="secondary" onClick={() => {setItems(previous => previous.filter(p => p.requestId !== item.requestId)); invalidate();}}>Remove screenshot {index + 1} from review</Button></div>}
        {item.result && <div className="mt-3"><Button variant="secondary" onClick={() => setSource({ result: item.result!, title: `Screenshot ${index + 1}` })}>View screenshot {index + 1}</Button></div>}
      </li>)}</ol>}
      {(initial.attempts.some(a => a.status === "FAILED" && !isAllianceRejection(a)) || items.some(i => i.state === "failed")) && <label className="mt-4 flex items-start gap-3 text-sm text-text-secondary"><input type="checkbox" checked={retryFailed} disabled={busy || !queued.length} onChange={e => setRetryFailed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
        <span>Start a new attempt for failed images I selected again. Each reserves another $0.01 from the $5 trial cap. Earlier failures stay in history. Completed scans are reused.</span></label>}
      <label className="mt-4 flex items-start gap-3 text-sm text-text-secondary"><input type="checkbox" checked={consent} disabled={busy || !queued.length} onChange={e => setConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
        <span>I can share these screenshots with ACC and Google Cloud for text recognition. Prepared images and recognized text are available for 30 days, then scheduled for deletion. Upload history is retained.</span></label>
      <div className="mt-4 flex flex-wrap gap-3"><Button disabled={busy || !consent || !queued.length} onClick={scan}>{busy ? "Reading screenshots…" : `Read ${queued.length || "selected"} screenshots`}</Button>
        {busy ? <Button variant="secondary" onClick={() => { cancel.current = true; setMessage("Stopping after the current image. A scan already sent cannot be recalled."); }}>Stop after this image</Button>
          : <Button variant="secondary" disabled={!items.length} onClick={() => { setItems([]); setSource(null); setConsent(false); invalidate(); setMessage("Review cleared. Retained scans remain in upload history."); }}>Clear review</Button>}</div>
    </Card>
    <section aria-labelledby="batch-review-heading"><h2 id="batch-review-heading" className="text-lg font-semibold">2. Review all recognized members</h2>
      <h3 className="mt-4 font-semibold">Confirm the screenshot dates</h3>
      <p className="mt-2 text-sm text-text-secondary">Choose the Monday that starts the week these screenshots came from, then review and confirm each resulting date. Review different weeks separately. A weekday in an image does not tell us which calendar week it belongs to.</p>
      <div className="my-4 grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Week beginning (Monday)<input id="ranking-calendar-week" type="date" value={week} disabled={busy} aria-invalid={weekInvalid} aria-describedby={weekInvalid ? "ranking-week-error" : undefined} onChange={e => { setWeek(e.target.value); invalidate(); }} className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface p-3 text-base" /></label>
        {results.some(r => r.batchReview.context.kind === "today") && <label className="grid gap-2 text-sm font-medium">Game date shown as Today&apos;s Duel<input type="date" value={captureDate} disabled={busy} onChange={e => { setCaptureDate(e.target.value); invalidate(); }} className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface p-3 text-base" /></label>}</div>
      {weekInvalid && <p id="ranking-week-error" role="alert" className="mb-3 rounded-lg border border-warning p-3 text-sm text-warning-light">Choose a Monday for the start of the week. This field selects the week, not a replacement day for the screenshot. The detected weekday cannot be changed.</p>}
      <p className="text-sm text-text-secondary">A Monday screenshot stays on Monday, and a Tuesday screenshot stays on Tuesday within the chosen week. Weekly Rank stays a separate weekly total. The upload date is not evidence of the game date.</p>
      {results.length > 0 && <ul className="mt-3 space-y-1 text-sm">{items.map((item, i) => item.result && (() => { const window = rankingWindow(item.result.batchReview.context, week, captureDate); return <li key={item.requestId}>Screenshot {i + 1} · {item.result.batchReview.context.label}: {window?.startsWith("week:") ? `week beginning ${window.slice(5)}` : window || "Choose the correct week or game date above"}</li>; })())}</ul>}
      <div className="my-4"><Button variant="secondary" disabled={!calendarReady} onClick={() => setCalendarOpen(true)}>Review screenshot dates</Button>
        {dateConfirmed && <p className="mt-2 text-sm text-primary-light">Screenshot dates confirmed. Changing the week, game date or screenshots requires confirmation again.</p>}</div>
      {calendarOpen && <ConfirmDialog isOpen onClose={() => setCalendarOpen(false)} title="Use these screenshot dates?" confirmLabel="Confirm dates" confirmDisabled={!calendarReady}
        description={<div className="space-y-3 text-sm text-text-secondary"><p>Check the detected source day against the date assigned below. You are confirming the calendar week; the screenshot&apos;s weekday will not change.</p>
          <ul className="space-y-2">{items.map((item, i) => item.result && <li key={item.requestId}><strong>Screenshot {i + 1} · {item.result.batchReview.context.label}</strong><br />{(() => { const window = rankingWindow(item.result.batchReview.context, week, captureDate); return window?.startsWith("week:") ? `Weekly total · week beginning ${window.slice(5)}` : window ? `Daily score · ${window}` : "Date unavailable"; })()}</li>)}</ul>
          <p>Different daily dates and weekly totals remain separate. If these dates are wrong, cancel and choose the correct week. This recognition review does not save scores.</p></div>}
        onConfirm={async () => { if (!calendarReady) return { error: "Check the screenshot dates before confirming." }; setDateConfirmed(true); setReviewed(false); }} />}
      {items.map((item, i) => item.result && (() => { const r = item.result; return <div key={r.attempt.id} className="mb-3 text-sm">
        {(r.batchReview.context.kind === "missing" || !r.batchReview.rows.length) && <p className="rounded-lg border border-warning p-3 text-warning-light">Screenshot {i + 1}: {r.batchReview.context.kind === "missing" ? "The selected weekday or Weekly Rank could not be verified. Upload an uncropped image with the selection visible." : "No complete name-and-score rows could be read. Check the image and use a clearer capture."}</p>}
        {r.contextChanged && <p className="rounded-lg border border-warning p-3 text-warning-light">The roster or access changed since screenshot {i + 1}. This is historical evidence; refresh and start a new review before using it.</p>}
        {showCurrentDayProgress(r.batchReview, dateConfirmed ? rankingWindow(r.batchReview.context, week, captureDate) : null) && <p className="rounded-lg border border-border p-3 text-primary-light">Screenshot {i + 1}: the current game day is in progress · {r.batchReview.countdown} remaining. These scores can increase.</p>}
      </div>; })())}
      <p className="mb-3 text-sm text-text-muted">{grouped.length} unique rows · {grouped.reduce((n, g) => n + g.duplicates, 0)} overlapping rows · {pending.length} rows need review{unresolvedImages ? ` · ${unresolvedImages} screenshots need attention` : ""}</p>
      {grouped.length === 0 ? <Card><p className="text-text-secondary">Recognized names and scores will appear together here.</p></Card> : <ol className="grid gap-3 lg:grid-cols-2">{grouped.map(({ row, sources, conflict }) => {
        const key = `${row.attemptId}:${row.key}`; const skip = excluded.includes(key);
        return <li key={key} className="min-w-0 rounded-xl border border-border bg-surface p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{row.sourceName || "Unreadable name"}</strong><strong className="tabular-nums">{row.value?.toLocaleString("en-US") ?? row.sourceValue}</strong></div>
          <p className="mt-2 text-sm text-text-secondary">{row.window?.startsWith("week:") ? `Weekly total · week of ${row.window.slice(5)}` : row.window ? `Daily score · ${row.window}` : <>Calendar context needs review — <a href="#ranking-calendar-week" className="text-primary-light underline">choose the week and confirm the dates above</a>.</>}</p>
          <p className="mt-2 text-sm text-text-secondary">{statusText[row.status]}{row.status !== "exact" && row.matchedName ? `: ${row.matchedName}` : ""}</p>
          {row.allianceLabel && <p className="mt-1 break-words text-sm text-text-muted">Source alliance: {row.allianceLabel}</p>}
          {conflict && <p className="mt-2 text-sm text-warning-light">These images show different values for the same member and result window. No value has been chosen automatically.</p>}
          <p className="mt-2 text-xs text-text-muted">Source screenshots: {sources.map(s => s.source).join(", ")}{sources.length > 1 && !conflict ? " · same value shown once" : ""}</p>
          <div className="mt-3 flex flex-wrap gap-3"><Button variant="secondary" onClick={() => setSource({ result: results.find(r => r.attempt.id === row.attemptId)!, title: `Source for ${row.sourceName || "row"}` })}>View source for {row.sourceName || "row"}</Button>
            <Button variant="secondary" onClick={() => { setExcluded(previous => skip ? previous.filter(k => k !== key) : [...previous, key]); setReviewed(false); }}>{skip ? "Include in review" : "Exclude from review"}</Button></div>
          {skip && <p className="mt-2 text-sm text-text-muted">Excluded from this review</p>}
        </li>;
      })}</ol>}
      {grouped.length > 0 && <div className="mt-4 rounded-lg border border-border p-4 text-sm"><p>Ranking tabs identify the score&apos;s period. No timer does not prove completion. Weekly totals stay separate from daily scores and are never added to them.</p>
        <p className="mt-2 text-text-secondary">Monday and Weekly Rank can be reviewed together for the same week. A weekly total includes daily scores; it does not replace them or tell us the missing days. This trial flags conflicting values for the same day or week, but does not yet compare weekly totals against the daily scores. Upload order does not establish when a screenshot was taken.</p>
        <p className="mt-2 text-text-secondary">This trial stops at recognition review. Name exceptions, lower-score confirmation and saving through the shared score-history rules will be available in the next submission step.</p>
        <div className="mt-4"><Button disabled={busy || pending.length > 0 || unresolvedImages > 0 || !chosen.length} onClick={() => { setReviewed(true); setMessage("Recognition review complete. No member scores or reports were changed."); }}>Finish recognition review</Button></div>
        {reviewed && <p className="mt-3 text-primary-light">Recognition reviewed · No scores saved</p>}</div>}
    </section>
    {notice && <AllianceBatchDialog {...notice} allianceName={initial.allianceName} server={initial.server} onClose={() => { setNotice(null); input.current?.focus(); }} />}
    {source && <RankingScreenshotDialog key={source.result.attempt.id}
      imageUrl={`${endpoint}&id=${encodeURIComponent(source.result.attempt.id)}&kind=image`}
      title={source.title} periodLabel={source.result.batchReview.context.label}
      uploadedBy={source.result.attempt.actorName} uploadedAt={source.result.attempt.createdAt}
      onClose={() => setSource(null)} />}
    <p role="status" aria-live="polite" className="break-words text-sm text-text-secondary">{message}</p>
    <section><h2 className="text-lg font-semibold">Ranking upload history</h2><p className="mt-1 text-sm text-text-muted">Latest 20 captures · Times shown in your timezone. Reopening a scan does not send it to Google again. To retry a failed image, select it again and explicitly confirm a new paid attempt above.</p>
      <ol className="mt-3 grid gap-3 md:grid-cols-2">{existing.map(attempt => <li key={attempt.id} className="min-w-0 rounded-lg border border-border p-3 text-sm"><p className="break-words">{attempt.actorName} · <LocalTimestamp value={attempt.createdAt} /></p>{isAllianceRejection(attempt) && <p className="mt-2 text-warning-light">{allianceRejectionMessage(attempt.outcome)}</p>}<div className="mt-2"><Button variant="secondary" disabled={busy || attempt.status !== "READY" || items.length >= 20} onClick={() => reopen(attempt)}>{attempt.status === "READY" ? "Add scan to review" : isAllianceRejection(attempt) ? "Blocked — alliance check" : "Failed or pending — not retried"}</Button></div></li>)}</ol>
    </section>
  </div>;
}
