"use client";
import { LocalTimestamp } from "./LocalTimestamp";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import type { Recognition, VsReview } from "@/app/src/lib/ocr/recognition";
import { uploadWithRetry } from "@/app/src/lib/ocr/uploadWithRetry";
import { recognitionFailureMessage } from "@/app/src/lib/ocr/recognitionFailure";
import { allianceRejectionMessage, isAllianceRejection, allianceBatchNotice } from "@/app/src/lib/ocr/allianceEvidence";

import { AllianceBatchDialog } from "./AllianceBatchDialog";

type Attempt = { firstAttemptAt?: string; firstRequestId?: string; sourceFilename: string | null; id: string; createdAt: string; expiresAt: string; actorName: string; actorRole: string; playerName: string; status: string; outcome: string | null };
type Result = { recognition: Recognition; review: VsReview; attempt: Attempt;
  capturedTarget: { playerName: string; allianceName: string; server: string }; contextChanged: boolean };
type Props = { allianceId: string; memberId: string | null; synthetic: boolean; initial: {
  playerName: string; allianceName: string; server: string; leader: boolean; contextKey: string; processingConsentId: number | null; attempts: Attempt[];
} };

export function ScreenshotReview({ allianceId, memberId, initial, synthetic }: Props) {
  const [notice, setNotice] = useState<ReturnType<typeof allianceBatchNotice>>(null);
  const [blockedOutcome, setBlockedOutcome] = useState<string | null>(null);
  const router = useRouter(); const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  const [result, setResult] = useState<Result | null>(null); const [additionalAttempts, setAdditionalAttempts] = useState<Attempt[]>([]);
  const attempts = [...initial.attempts, ...additionalAttempts.filter(a => !initial.attempts.some(existing => existing.id === a.id))]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 20);
  const [requestId, setRequestId] = useState(""); const operation = useRef(0); const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const endpoint = `/api/ocr-evaluation?${new URLSearchParams({ allianceId, ...(memberId ? { memberId } : {}) })}`;
  useEffect(() => () => { operation.current++; controller.current?.abort(); }, []);

  function clear() {
    operation.current++; controller.current?.abort(); setBusy(false); setFile(null); setResult(null);
    setNotice(null); setBlockedOutcome(null);
    setMessage("Selection cleared. A scan already sent may still finish; its history is retained.");
    setRequestId(""); if (input.current) input.current.value = "";
  }
  async function readResult(id: string) {
    const response = await fetch(`${endpoint}&id=${encodeURIComponent(id)}&kind=result`, { cache: "no-store", signal: controller.current?.signal });
    const body = await response.json(); if (!response.ok) throw Object.assign(new Error(body.error || "Recognition is unavailable."), { outcome: body.outcome });
    return body as Result;
  }
  async function inspect(attempt: Attempt) {
    const token = ++operation.current; controller.current?.abort(); controller.current = new AbortController();
    setBusy(true); setMessage(""); setResult(null); setFile(null); setNotice(null); setBlockedOutcome(null);
    try {
      const next = await readResult(attempt.id);
      if (token !== operation.current) return;
      setResult(next);
    } catch (error) { if (token === operation.current) { setMessage(error instanceof Error ? error.message : "Unable to open this scan."); if (isAllianceRejection(error)) block(error.outcome); } }
    finally { if (token === operation.current) setBusy(false); }
  }
  function block(outcome: string) {
    setFile(null); setBlockedOutcome(outcome); setMessage(allianceRejectionMessage(outcome));
    setNotice(allianceBatchNotice([{ state: "blocked", outcome }]));
  }
  async function scan() {
    if (!file || busy) return;
    const token = ++operation.current; controller.current = new AbortController(); setBusy(true); setMessage(""); setResult(null); setNotice(null); setBlockedOutcome(null);
    const form = new FormData(); form.set("screenshot", file, "screenshot"); form.set("sourceFilename", file.name); form.set("requestId", requestId);
    form.set("contextKey", initial.contextKey); form.set("processingConsentId", String(initial.processingConsentId));
    try {
      const attempt: Attempt = await uploadWithRetry(endpoint, form, {
        onRetry: () => setMessage("Retrying scan…"), cancelled: () => token !== operation.current,
        signal: controller.current.signal,
      });
      if (token !== operation.current) return;
      setAdditionalAttempts(previous => [attempt, ...previous.filter(a => a.id !== attempt.id)].slice(0, 20));
      if (isAllianceRejection(attempt)) { block(attempt.outcome); return; }
      if (attempt.status !== "READY") { setMessage(recognitionFailureMessage(attempt.outcome) ?? "This attempt has not completed. It will not be sent again automatically. Reload to check its history."); return; }
      const next = await readResult(attempt.id);
      if (token === operation.current) { setResult(next); setFile(null); setMessage("Recognition is ready to review. No scores were changed."); }
    } catch (error) { if (token === operation.current) { setMessage(error instanceof Error ? error.message : "The scan did not complete. Reload before trying again."); if (isAllianceRejection(error)) block(error.outcome); } }
    finally { if (token === operation.current) { setBusy(false); router.refresh(); } }
  }
  const matched = result?.review.identity === "candidate";
  return <div className="space-y-6" data-sentry-block>
    <div className="rounded-xl border border-border bg-surface p-4 text-sm text-text-secondary">
      <div className="flex flex-wrap items-center gap-3"><Badge variant="info">{synthetic ? "Synthetic test fixture" : "Recognition trial"}</Badge><strong>No scores will be changed</strong></div>
      <p className="mt-3">Reviewing <strong className="break-words text-text-primary">{initial.playerName}</strong> · {initial.allianceName} · Server {initial.server}</p>
    </div>
    <div className="grid min-w-0 gap-6 md:grid-cols-2">
      <section className="min-w-0 space-y-4" aria-labelledby="screenshot-heading">
        <Card><h2 id="screenshot-heading" className="text-lg font-semibold">1. Choose a daily VS screenshot</h2>
          <p className="mt-2 text-sm text-text-secondary">Keep the full Alliance Duel screen, player names, scores and countdown visible. PNG or JPEG, up to 2 MB.</p>
          <p className="mt-2 text-sm text-text-secondary">Only this alliance&apos;s screenshots are accepted. Different, mixed or unreadable alliances are blocked, with no override.</p>
          <label htmlFor="vs-screenshot" className="mt-4 block text-sm font-medium">Screenshot</label>
          <input ref={input} id="vs-screenshot" type="file" accept="image/png,image/jpeg" disabled={busy} className="mt-2 block w-full min-w-0 rounded-lg border border-border p-2 text-sm focus:outline-2 focus:outline-primary"
            onChange={event => { const selected = event.target.files?.[0] ?? null; setResult(null); setMessage(""); setBlockedOutcome(null); setNotice(null);
              if (selected && (selected.size > 2 * 1024 * 1024 || !["image/png", "image/jpeg"].includes(selected.type))) { setFile(null); setMessage("Choose one PNG or JPEG no larger than 2 MB."); return; }
              setFile(selected); setRequestId(crypto.randomUUID()); }} />
          <div className="mt-4 flex flex-wrap gap-3"><Button onClick={scan} disabled={!file || busy}>{busy ? "Reading screenshot…" : "Read screenshot"}</Button>
            <Button onClick={clear} variant="secondary">{busy ? "Cancel waiting" : "Clear selection"}</Button></div>
          <p className="mt-3 text-xs text-text-muted">Cancelling waiting cannot recall an image already sent. A temporary Google outage triggers one retry after two seconds.</p>
        </Card>
        {blockedOutcome && <Card><h3 className="font-semibold">Screenshot blocked</h3><p className="mt-2 text-sm text-warning-light">{allianceRejectionMessage(blockedOutcome)}</p></Card>}
        {(file || result) && <Card><h3 className="mb-3 font-semibold">{result ? "Retained screenshot" : "Selected screenshot"}</h3>
          {file ? <LocalScreenshot key={requestId} file={file} onError={setMessage} /> : result && <>
          {/* The authenticated private image must bypass Next's public optimizer/cache. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={`${endpoint}&id=${encodeURIComponent(result.attempt.id)}&kind=image`} alt="Daily VS screenshot being reviewed" className="h-auto max-h-[70vh] w-full rounded-lg object-contain" referrerPolicy="no-referrer" onError={() => setMessage("The screenshot is unavailable. It may have expired or your access may have changed.")} />
          </>}
          {result && <p className="mt-3 text-xs text-text-muted">Orientation corrected; image metadata removed. Access ends <LocalTimestamp value={result.attempt.expiresAt} />.</p>}
        </Card>}
      </section>
      <section className="min-w-0 space-y-4" aria-labelledby="recognition-heading">
        <Card><h2 id="recognition-heading" className="text-lg font-semibold">2. Review the recognition</h2>
          {!result ? <p className="mt-3 text-text-secondary">Recognized text will appear here. Compare it with the screenshot before any future score submission.</p> : <div className="mt-4 space-y-4">
            <p className="break-words text-sm text-text-secondary">Target at upload: <strong>{result.capturedTarget.playerName}</strong> · {result.capturedTarget.allianceName} · Server {result.capturedTarget.server}</p>
            {result.contextChanged && <p className="rounded-lg border border-warning p-3 text-sm text-warning-light">The member identity or access context has changed since this scan. These results describe the target at upload, not a match against the current record. Review a new screenshot before any future submission.</p>}
            <Badge variant={matched ? "info" : "warning"}>{matched ? result.contextChanged ? "Name candidate in original review" : "Name candidate found — review needed" : result.review.identity === "ambiguous" ? "Ambiguous name — blocked" : "Matching name not found — blocked"}</Badge>
            {!matched && <p className="text-sm text-warning-light">{initial.leader ? "This screenshot does not clearly match the selected member. A future leadership submission would require an explicit resolution and warning." : "This screenshot cannot be accepted for your member record. Use a screenshot that clearly shows your current in-game name."}</p>}
            {!result.review.supportedScreen && <p className="text-sm text-warning-light">The daily Alliance Duel screen was not recognized. No score candidate is assigned.</p>}
            <dl className="space-y-3 text-sm"><div><dt className="text-text-muted">Name as read</dt><dd className="mt-1 break-words">{result.review.sourceName ?? "No unambiguous matching row"}</dd></div>
              <div><dt className="text-text-muted">Score candidate</dt><dd className="mt-1 text-2xl font-semibold tabular-nums">{result.review.score?.toLocaleString("en-US") ?? "Needs review"}</dd></div>
              <div><dt className="text-text-muted">Result status</dt><dd className="mt-1">{result.review.progress === "in-progress" ? `Countdown visible · ${result.review.countdown} · game date unconfirmed` : "Unknown — completion not established"}</dd></div>
              <div><dt className="text-text-muted">Game day</dt><dd className="mt-1">Not established by this screenshot review</dd></div></dl>
            <p className="rounded-lg border border-border p-3 text-sm text-text-secondary">OCR reads text; it does not prove image authenticity, member identity, the game date or a final score. Nothing here changes the member&apos;s record.</p>
            <details><summary className="cursor-pointer text-sm font-medium text-primary-light">Show all recognized text</summary><pre className="mt-3 whitespace-pre-wrap break-words rounded-lg bg-surface-secondary p-3 text-sm">{result.recognition.text || "No text was recognized."}</pre></details>
          </div>}
        </Card>
        <p role="status" aria-live="polite" className="break-words text-sm text-text-secondary">{message}</p>
      </section>
    </div>
    {notice && <AllianceBatchDialog {...notice} allianceName={initial.allianceName} server={initial.server} onClose={() => { setNotice(null); input.current?.focus(); }} />}
    <section aria-labelledby="scan-history"><h2 id="scan-history" className="text-lg font-semibold">Screenshot review history</h2>
      <p className="mb-4 mt-1 text-sm text-text-muted">Latest 20 attempts · This is upload history, not accepted score history.</p>
      {attempts.length === 0 ? <Card><p className="text-sm text-text-secondary">No screenshot evaluations yet.</p></Card> : <ol className="grid gap-3 lg:grid-cols-2">{attempts.map(attempt => <li key={attempt.id} className="min-w-0 rounded-xl border border-border bg-surface p-4">
        <p className="break-words font-medium">{attempt.sourceFilename ?? "Original filename unavailable"}</p><p className="mt-1 break-words text-sm text-text-secondary">Uploaded by {attempt.actorName} · {attempt.actorRole.toLowerCase()} · <LocalTimestamp value={attempt.createdAt} /></p>
        <p className="mt-2 text-sm text-text-muted">{attempt.status === "READY" ? "Recognition complete" : isAllianceRejection(attempt) ? "Blocked — alliance check" : attempt.status === "FAILED" ? "Scan failed" : "Processing or interrupted — no automatic retry"}</p>
        {attempt.firstAttemptAt && <p className="mt-1 text-sm text-text-muted">First scan · <LocalTimestamp value={attempt.firstAttemptAt} /> · Google temporarily unavailable</p>}
        {recognitionFailureMessage(attempt.outcome) && <p className="mt-2 text-sm text-warning-light">{recognitionFailureMessage(attempt.outcome)}</p>}
        {isAllianceRejection(attempt) && <p className="mt-2 text-sm text-warning-light">{allianceRejectionMessage(attempt.outcome)}</p>}
        <div className="mt-3"><Button variant="secondary" disabled={busy || attempt.status !== "READY"} onClick={() => inspect(attempt)}>Review scan</Button></div>
      </li>)}</ol>}
    </section>
  </div>;
}

// Decode local selection into pixels rather than passing a file-backed URL to
// a markup-loading element. The server independently validates/normalizes it.
function LocalScreenshot({ file, onError }: { file: File; onError: (message: string) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    let cancelled = false;
    createImageBitmap(file).then(bitmap => {
      try {
        if (cancelled || !canvas.current) return;
        if (bitmap.width < 200 || bitmap.height < 200 || bitmap.width * bitmap.height > 12_000_000) {
          onError("Choose a screenshot at least 200 × 200 pixels and no larger than 12 megapixels.");
          return;
        }
        canvas.current.width = bitmap.width;
        canvas.current.height = bitmap.height;
        const context = canvas.current.getContext("2d");
        if (!context) throw new Error("Preview unavailable");
        context.drawImage(bitmap, 0, 0);
      } finally { bitmap.close(); }
    }).catch(() => { if (!cancelled) onError("This file could not be displayed as a screenshot. Choose a valid PNG or JPEG."); });
    return () => { cancelled = true; };
  }, [file, onError]);
  return <canvas ref={canvas} width={1} height={1} role="img" aria-label="Selected daily VS screenshot" className="h-auto max-h-[70vh] w-full rounded-lg object-contain" />;
}
