"use client";
import { useEffect, useId, useRef } from "react";
import { Button } from "@/app/src/components/Button";

type Props = { count: number; allForeign: boolean; allianceName: string; server: string; onClose: () => void };

/** Read-only notice. Dismissing it never accepts a screenshot or retries a scan. */
export function AllianceBatchDialog({ count, allForeign, allianceName, server, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null); const close = useRef<HTMLButtonElement>(null);
  const title = useId(); const description = useId();
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    const previousOverflow = document.body.style.overflow;
    node.showModal(); document.body.style.overflow = "hidden";
    return () => { if (node.open) node.close(); document.body.style.overflow = previousOverflow; };
  }, []);
  return <dialog ref={dialog} aria-labelledby={title} aria-describedby={description}
    onClose={event => { if (!event.currentTarget.open) onClose(); }}
    onKeyDown={event => { if (event.key === "Tab") { event.preventDefault(); close.current?.focus(); } }}
    className="fixed inset-0 m-auto max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto rounded-xl border border-border bg-surface p-5 text-text-primary shadow-2xl backdrop:bg-black/70">
    <h2 id={title} className="break-words text-xl font-semibold">{allForeign ? "No screenshots match your alliance" : "No screenshots could be verified for this alliance"}</h2>
    <div id={description} className="mt-4 space-y-3 break-words text-sm text-text-secondary">
      <p>{allForeign ? (count === 1 ? "This screenshot does not match" : `None of the ${count} selected screenshots match`) : `We could not verify any of the ${count} selected screenshots for`} <strong className="text-text-primary">{allianceName} · Server {server}</strong>.</p>
      <p>No results were added. {allForeign ? "Choose screenshots from this alliance." : "Check each screenshot’s warning for a different, mixed or unreadable alliance."} Keep the alliance labels visible and use Your Alliance in the game when available.</p>
      <p>Your screenshots’ warnings and upload history stay available when you close this message. Nothing will be retried automatically.</p>
    </div>
    <div className="mt-5 flex justify-end"><Button ref={close} autoFocus onClick={() => dialog.current?.close()}>Back to screenshots</Button></div>
  </dialog>;
}
