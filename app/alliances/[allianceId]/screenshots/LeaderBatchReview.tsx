"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { RankingScreenshotDialog } from "./RankingScreenshotDialog";
import { rankingWindow, reconcileOverlap, showCurrentDayProgress, type RankingReview, type RosterMember } from "@/app/src/lib/ocr/ranking";

type Attempt = { id: string; status: string; createdAt: string; actorName: string; actorRole: string };
type Result = { attempt: Attempt; batchReview: RankingReview; contextChanged: boolean };
type Item = { requestId: string; file: File | null; state: "queued" | "reading" | "ready" | "failed"; error?: string; result?: Result };
type Props = { allianceId: string; initial: { contextKey: string; members: RosterMember[]; attempts: Attempt[] }; synthetic: boolean };
const statusText = { exact: "Exact name candidate", suggested: "Suggested match — confirm the name", ambiguous: "Ambiguous roster name", unmatched: "No roster match", invalid: "Unreadable name or score", archived: "Archived member — review required" };

export function LeaderBatchReview({ allianceId, initial, synthetic }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<Item[]>([]); const [week, setWeek] = useState(""); const [captureDate, setCaptureDate] = useState("");
  const [retryFailed, setRetryFailed] = useState(false);
  const [dateConfirmed, setDateConfirmed] = useState(false); const [consent, setConsent] = useState(false);
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
  const existing = initial.attempts.filter(a => !results.some(r => r.attempt.id === a.id));

  function invalidate() { setReviewed(false); setDateConfirmed(false); setExcluded([]); }
  async function read(id: string): Promise<Result> {
    const response = await fetch(`${endpoint}&id=${encodeURIComponent(id)}&kind=result`, { cache: "no-store" });
    const result = await response.json(); if (!response.ok) throw new Error(result.error || "This scan is unavailable.");
    if (!result.batchReview) throw new Error("This is not an alliance ranking capture.");
    return result;
  }
  async function scan() {
    if (busy || !consent || !queued.length) return;
    cancel.current = false; setBusy(true); setMessage(""); setReviewed(false);
    for (const item of queued) {
      if (cancel.current || !active.current) break;
      setItems(previous => previous.map(p => p.requestId === item.requestId ? { ...p, state: "reading" } : p));
      try {
        const form = new FormData(); form.set("screenshot", item.file!, "screenshot"); form.set("requestId", item.requestId);
        form.set("consent", "true"); form.set("contextKey", initial.contextKey); form.set("retryFailed", String(retryFailed));
        const response = await fetch(endpoint, { method: "POST", body: form }); const attempt = await response.json();
        if (!response.ok) throw new Error(attempt.error || "This screenshot did not complete.");
        if (attempt.status !== "READY") throw new Error("This attempt failed or is still pending. It was not sent again. Check upload history before starting another scan.");
        const result = await read(attempt.id);
        if (active.current) setItems(previous => {
          const reused = previous.some(p => p.requestId !== item.requestId && p.result?.attempt.id === result.attempt.id);
          return reused ? previous.filter(p => p.requestId !== item.requestId) : previous.map(p => p.requestId === item.requestId ? { ...p, file: null, state: "ready", result } : p);
        });
      } catch (error) {
        if (active.current) setItems(previous => previous.map(p => p.requestId === item.requestId ? { ...p, file: null, state: "failed", error: error instanceof Error ? error.message : "Scan failed." } : p));
        // An uncertain result must not trigger another paid request automatically.
        cancel.current = true;
      }
    }
    if (active.current) { router.refresh(); setBusy(false); setConsent(false); setRetryFailed(false); setMessage(cancel.current ? "Stopped. Completed scans remain below; unstarted images are still queued. No scan is retried automatically." : items.some(item => item.state === "failed") ? "Remaining scans completed. Earlier failed images still need attention. No scores were saved." : "Batch recognition is ready. Review the names, scores and source periods together. No scores were saved."); }
  }
  async function reopen(attempt: Attempt) {
    setBusy(true); setMessage("");
    try { const result = await read(attempt.id); setItems(previous => previous.some(p => p.result?.attempt.id === attempt.id) ? previous : [...previous, { requestId: attempt.id, file: null, state: "ready", result }]); invalidate(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Scan unavailable."); }
    finally { setBusy(false); }
  }
  return <div className="space-y-6 sentry-block" data-sentry-block>
    <div className="rounded-xl border border-border bg-surface p-4"><div className="flex flex-wrap items-center gap-3"><Badge variant="info">{synthetic ? "Synthetic test fixture" : "Recognition trial"}</Badge><strong>Review only · Scores are not saved</strong></div>
      <p className="mt-2 text-sm text-text-secondary">Upload the ranking capture once. Review every recognized member here, without opening individual member pages.</p></div>
    <Card><h2 className="text-lg font-semibold">1. Add your ranking screenshots</h2>
      <p className="mt-2 text-sm text-text-secondary">Keep the selected weekday or Weekly Rank visible on every image, with the full names and points. PNG or JPEG, up to 2 MB each. Choose up to 20 images; scans also have a daily account limit.</p>
      <label htmlFor="ranking-screenshots" className="mt-4 block font-medium">Ranking screenshots</label>
      <input id="ranking-screenshots" ref={input} type="file" accept="image/png,image/jpeg" multiple disabled={busy} className="mt-2 block w-full min-w-0 rounded-lg border border-border p-2 text-sm focus:outline-2 focus:outline-primary"
        onChange={event => { const files = Array.from(event.target.files ?? []); if (!files.length) return;
          if (files.length + items.length > 20 || files.some(f => f.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(f.type))) { setMessage("Choose up to 20 PNG or JPEG images, each no larger than 2 MB."); event.target.value = ""; return; }
          setItems(previous => [...previous, ...files.map(file => ({ file, requestId: crypto.randomUUID(), state: "queued" as const }))]); setConsent(false); setRetryFailed(false); invalidate(); setMessage(""); event.target.value = ""; }} />
      {items.length > 0 && <ol className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{items.map((item, index) => <li key={item.requestId} className="min-w-0 rounded-lg border border-border p-3 text-sm">
        <strong>Screenshot {index + 1}</strong><p className="mt-1 text-text-secondary">{item.state === "ready" ? item.result!.batchReview.context.label : item.state === "reading" ? "Reading…" : item.state === "failed" ? "Needs attention" : "Queued"}</p>
        {item.error && <p className="mt-2 break-words text-warning-light">{item.error}</p>}
        {!busy && (item.state === "failed" || item.state === "queued") && <div className="mt-3"><Button variant="secondary" onClick={() => {setItems(previous => previous.filter(p => p.requestId !== item.requestId)); invalidate();}}>Remove screenshot {index + 1} from review</Button></div>}
        {item.result && <div className="mt-3"><Button variant="secondary" onClick={() => setSource({ result: item.result!, title: `Screenshot ${index + 1}` })}>View screenshot {index + 1}</Button></div>}
      </li>)}</ol>}
      {(initial.attempts.some(a => a.status === "FAILED") || items.some(i => i.state === "failed")) && <label className="mt-4 flex items-start gap-3 text-sm text-text-secondary"><input type="checkbox" checked={retryFailed} disabled={busy || !queued.length} onChange={e => setRetryFailed(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
        <span>Start a new attempt for failed images I selected again. Each reserves another $0.01 from the $5 trial cap. Earlier failures stay in history. Completed scans are reused.</span></label>}
      <label className="mt-4 flex items-start gap-3 text-sm text-text-secondary"><input type="checkbox" checked={consent} disabled={busy || !queued.length} onChange={e => setConsent(e.target.checked)} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
        <span>I can share these screenshots with ACC and Google Cloud for text recognition. Prepared images and recognized text are available for 30 days, then scheduled for deletion. Upload history is retained.</span></label>
      <div className="mt-4 flex flex-wrap gap-3"><Button disabled={busy || !consent || !queued.length} onClick={scan}>{busy ? "Reading screenshots…" : `Read ${queued.length || "selected"} screenshots`}</Button>
        {busy ? <Button variant="secondary" onClick={() => { cancel.current = true; setMessage("Stopping after the current image. A scan already sent cannot be recalled."); }}>Stop after this image</Button>
          : <Button variant="secondary" disabled={!items.length} onClick={() => { setItems([]); setSource(null); setConsent(false); invalidate(); setMessage("Review cleared. Retained scans remain in upload history."); }}>Clear review</Button>}</div>
    </Card>
    <section aria-labelledby="batch-review-heading"><h2 id="batch-review-heading" className="text-lg font-semibold">2. Review all recognized members</h2>
      <div className="my-4 grid gap-4 md:grid-cols-2"><label className="grid gap-2 text-sm font-medium">Week beginning (Monday)<input type="date" value={week} onChange={e => { setWeek(e.target.value); invalidate(); }} className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface p-3 text-base" /></label>
        {results.some(r => r.batchReview.context.kind === "today") && <label className="grid gap-2 text-sm font-medium">Game date shown as Today&apos;s Duel<input type="date" value={captureDate} onChange={e => { setCaptureDate(e.target.value); invalidate(); }} className="min-h-11 w-full min-w-0 rounded-lg border border-border bg-surface p-3 text-base" /></label>}</div>
      <p className="text-sm text-text-secondary">The selected source tab determines daily versus weekly results. Choose the week these images came from; the upload date is not evidence of their game date.</p>
      <label className="my-4 flex items-start gap-3 text-sm"><input type="checkbox" checked={dateConfirmed} onChange={e => { setDateConfirmed(e.target.checked); setReviewed(false); }} className="mt-1 h-4 w-4 shrink-0 accent-primary" /><span>I have checked the calendar context for these screenshots.</span></label>
      {items.map((item, i) => item.result && (() => { const r = item.result; return <div key={r.attempt.id} className="mb-3 text-sm">
        {(r.batchReview.context.kind === "missing" || !r.batchReview.rows.length) && <p className="rounded-lg border border-warning p-3 text-warning-light">Screenshot {i + 1}: {r.batchReview.context.kind === "missing" ? "The selected weekday or Weekly Rank could not be verified. Upload an uncropped image with the selection visible." : "No complete name-and-score rows could be read. Check the image and use a clearer capture."}</p>}
        {r.contextChanged && <p className="rounded-lg border border-warning p-3 text-warning-light">The roster or access changed since screenshot {i + 1}. This is historical evidence; refresh and start a new review before using it.</p>}
        {showCurrentDayProgress(r.batchReview, dateConfirmed ? rankingWindow(r.batchReview.context, week, captureDate) : null) && <p className="rounded-lg border border-border p-3 text-primary-light">Screenshot {i + 1}: the current game day is in progress · {r.batchReview.countdown} remaining. These scores can increase.</p>}
      </div>; })())}
      <p className="mb-3 text-sm text-text-muted">{grouped.length} unique rows · {grouped.reduce((n, g) => n + g.duplicates, 0)} overlapping rows · {pending.length} rows need review{unresolvedImages ? ` · ${unresolvedImages} screenshots need attention` : ""}</p>
      {grouped.length === 0 ? <Card><p className="text-text-secondary">Recognized names and scores will appear together here.</p></Card> : <ol className="grid gap-3 lg:grid-cols-2">{grouped.map(({ row, sources, conflict }) => {
        const key = `${row.attemptId}:${row.key}`; const skip = excluded.includes(key);
        return <li key={key} className="min-w-0 rounded-xl border border-border bg-surface p-4"><div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{row.sourceName || "Unreadable name"}</strong><strong className="tabular-nums">{row.value?.toLocaleString("en-US") ?? row.sourceValue}</strong></div>
          <p className="mt-2 text-sm text-text-secondary">{row.window?.startsWith("week:") ? `Weekly total · week of ${row.window.slice(5)}` : row.window ? `Daily score · ${row.window}` : "Calendar context needs review"}</p>
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
        <p className="mt-2 text-text-secondary">This trial stops at recognition review. Name exceptions, lower-score confirmation and saving through the shared score-history rules will be available in the next submission step.</p>
        <div className="mt-4"><Button disabled={busy || pending.length > 0 || unresolvedImages > 0 || !chosen.length} onClick={() => { setReviewed(true); setMessage("Recognition review complete. No member scores or reports were changed."); }}>Finish recognition review</Button></div>
        {reviewed && <p className="mt-3 text-primary-light">Recognition reviewed · No scores saved</p>}</div>}
    </section>
    {source && <RankingScreenshotDialog key={source.result.attempt.id}
      imageUrl={`${endpoint}&id=${encodeURIComponent(source.result.attempt.id)}&kind=image`}
      title={source.title} periodLabel={source.result.batchReview.context.label}
      uploadedBy={source.result.attempt.actorName} uploadedAt={source.result.attempt.createdAt}
      onClose={() => setSource(null)} />}
    <p role="status" aria-live="polite" className="break-words text-sm text-text-secondary">{message}</p>
    <section><h2 className="text-lg font-semibold">Ranking upload history</h2><p className="mt-1 text-sm text-text-muted">Latest 20 captures · Reopening a scan does not send it to Google again. To retry a failed image, select it again and explicitly confirm a new paid attempt above.</p>
      <ol className="mt-3 grid gap-3 md:grid-cols-2">{existing.map(attempt => <li key={attempt.id} className="min-w-0 rounded-lg border border-border p-3 text-sm"><p className="break-words">{attempt.actorName} · {new Date(attempt.createdAt).toISOString()}</p><div className="mt-2"><Button variant="secondary" disabled={busy || attempt.status !== "READY" || items.length >= 20} onClick={() => reopen(attempt)}>{attempt.status === "READY" ? "Add scan to review" : "Failed or pending — not retried"}</Button></div></li>)}</ol>
    </section>
  </div>;
}
