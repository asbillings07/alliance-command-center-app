"use client";
import { type ReactNode, useRef, useState } from "react";
import { LocalTimestamp } from "@/app/alliances/[allianceId]/screenshots/LocalTimestamp";
import type { ImportErrorRow, ImportStep } from "@/app/src/lib/platform/importErrors";
import { loadScanHistory } from "./actions";

export function ErrorList({ rows, snapshot, summaries }: { rows: ImportErrorRow[]; snapshot: boolean; summaries?: ReactNode[] }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const sequence = useRef(0);
  const [selected, select] = useState<ImportErrorRow | null>(null);
  const [history, setHistory] = useState<ImportStep[] | "loading" | "error">([]);
  async function open(row: ImportErrorRow) {
    const current = ++sequence.current;
    select(row);
    const scan = row.key.startsWith("scan:");
    setHistory(scan ? "loading" : []);
    if (!dialog.current?.open) dialog.current?.showModal();
    if (!scan) return;
    try {
      const result = await loadScanHistory(row.key, snapshot);
      if (current === sequence.current) setHistory(result);
    } catch {
      if (current === sequence.current) setHistory("error");
    }
  }
  return <>
    <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
      {rows.map((row, index) => <li key={row.key}><button type="button" aria-haspopup="dialog" onClick={() => open(row)}
        className="flex w-full items-center justify-between gap-3 rounded-lg p-4 text-left hover:bg-surface-secondary focus-visible:outline-2 focus-visible:outline-primary">
        <span className="min-w-0">{summaries?.[index] ?? <><strong className="block">{row.reason}</strong>
          <span className="block text-sm text-text-secondary">{row.alliance} · {row.method} · <LocalTimestamp value={row.when} /></span></>}</span>
        <span aria-hidden="true">›</span>
      </button></li>)}
    </ul>
    <dialog ref={dialog} onClose={() => { sequence.current++; select(null); }} aria-labelledby="error-detail-title"
      className="fixed inset-0 m-auto max-h-[85dvh] w-[calc(100vw-2rem)] max-w-xl overflow-y-auto overscroll-contain rounded-xl border border-border bg-surface p-5 text-text-primary backdrop:bg-black/70">
      <div className="flex items-center justify-between gap-3"><h2 id="error-detail-title" className="text-lg font-semibold">Import details</h2>
        <button autoFocus className="rounded border border-border px-3 py-2" onClick={() => dialog.current?.close()}>Close</button></div>
      {selected && <div className="mt-4 space-y-4">
        <p className="font-semibold">{selected.reason}</p>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt>Alliance</dt><dd>{selected.alliance}</dd><dt>Account</dt><dd className="break-all">{selected.account}</dd>
          <dt>Import</dt><dd>{selected.method}</dd><dt>Evidence</dt><dd>{selected.source}</dd>
          <dt>Recorded</dt><dd><LocalTimestamp seconds value={selected.when} /></dd>
          <dt>App version</dt><dd>{selected.build ?? "Not recorded"}</dd>
        </dl>
        {selected.key.startsWith("scan:") ? <section className="border-t border-border pt-4"><h3 className="font-semibold">History for this screenshot</h3>
          {history === "loading" ? <p role="status">Loading attempts…</p> : history === "error" ? <p role="alert">History unavailable. <button className="underline" onClick={() => open(selected)}>Try again</button></p> :
          history.length === 0 ? <p>No related attempts available.</p> : <ol className="mt-2 divide-y divide-border">{history.map(item => <li key={item.key} className="py-2 text-sm">
            <strong>{item.action}</strong>{item.key === selected.key ? " · Selected attempt" : ""} · <LocalTimestamp seconds value={item.when} />
            <p>{item.outcome}</p><p className="text-text-secondary">App version · {item.build ?? "Not recorded"}</p>
            {item.scores > 0 && item.saved ? <p>{item.scores} scores confirmed · <LocalTimestamp value={item.saved} /></p> : item.outcome === "Ready for review" && <p>No confirmed scores recorded for this attempt.</p>}
          </li>)}</ol>}
        </section> : <p className="text-sm text-text-secondary">This report records what the user encountered. A later retry or save cannot be verified from this report alone.</p>}
      </div>}
    </dialog>
  </>;
}
