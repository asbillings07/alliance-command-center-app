"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Button } from "@/app/src/components/Button";

type Props = {
  imageUrl: string;
  title: string;
  periodLabel: string;
  uploadedBy: string;
  uploadedAt: string;
  onClose: () => void;
};

/** A read-only evidence viewer; native modal behavior keeps focus above the review. */
export function RankingScreenshotDialog({ imageUrl, title, periodLabel, uploadedBy, uploadedAt, onClose }: Props) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const imageRegionRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [enlarged, setEnlarged] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const previousOverflow = document.body.style.overflow;
    dialog.showModal();
    document.body.style.overflow = "hidden";
    return () => {
      if (dialog.open) dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return <dialog ref={dialogRef} onClose={event => {
    // Strict Mode can reopen after cleanup before the native queued close event arrives.
    if (!event.currentTarget.open) onClose();
  }} onKeyDown={event => {
    // Native dialogs make the page inert, but some browsers tab into browser chrome
    // at the boundary. Keep this viewer's keyboard loop within its visible controls.
    if (event.key !== "Tab") return;
    if (event.shiftKey && document.activeElement === closeRef.current) {
      event.preventDefault(); imageRegionRef.current?.focus();
    } else if (!event.shiftKey && document.activeElement === imageRegionRef.current) {
      event.preventDefault(); closeRef.current?.focus();
    }
  }} aria-labelledby={titleId} aria-describedby={descriptionId}
    className="fixed inset-0 m-auto h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-5xl max-h-[calc(100dvh-1rem)] overflow-hidden rounded-xl border border-border bg-surface p-0 text-text-primary shadow-2xl backdrop:bg-black/70">
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border p-4">
        <div className="min-w-0"><h2 id={titleId} className="break-words text-lg font-semibold">{title}</h2>
          <p id={descriptionId} className="mt-1 text-sm text-text-secondary">{periodLabel} · Read-only source preview</p></div>
        <Button ref={closeRef} autoFocus variant="secondary" onClick={() => dialogRef.current?.close()}>Close preview</Button>
      </header>
      <div className="flex shrink-0 flex-wrap items-center gap-3 px-4 py-3">
        <Button variant="secondary" disabled={!loaded || failed} aria-pressed={enlarged} onClick={() => setEnlarged(value => !value)}>
          {enlarged ? "Fit image" : "Enlarge image"}
        </Button>
        <p className="text-sm text-text-secondary">{enlarged ? "Scroll within the image to inspect the details." : "Enlarge to read names and scores."}</p>
      </div>
      <div ref={imageRegionRef} role="region" aria-label="Screenshot image" tabIndex={0} className="min-h-0 flex-1 overflow-auto overscroll-contain bg-background p-3 focus-visible:outline-2 focus-visible:outline-primary">
        {!loaded && !failed && <p role="status" className="p-4 text-sm text-text-secondary">Loading screenshot…</p>}
        {failed ? <p role="alert" className="p-4 text-sm text-warning-light">This screenshot is unavailable. It may have expired or your access changed. Close the preview and reload to check your access and upload history.</p> : <>
          {/* Private evidence must bypass the public image optimizer. Viewing never dispatches OCR. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Original ranking screenshot for batch review" referrerPolicy="no-referrer"
            className="block" style={enlarged ? { width: "max(100%, 900px)", maxWidth: "none", height: "auto" } : { width: "100%", height: "100%", objectFit: "contain" }}
            onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />
        </>}
      </div>
      <footer className="shrink-0 border-t border-border p-4 text-xs text-text-muted">
        <p className="break-words">Uploaded by {uploadedBy} · {new Date(uploadedAt).toISOString()}</p>
        <p className="mt-1">Recognition does not establish image authenticity. Your review stays unchanged when you close this preview.</p>
      </footer>
    </div>
  </dialog>;
}
