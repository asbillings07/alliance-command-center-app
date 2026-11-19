"use client";
import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import { OCR_PROCESSING_NOTICE, processingAllowed, type OcrConsentState } from "@/app/src/lib/ocr/consentPolicy";
import { refreshOcrConsent, updateOcrConsent } from "./actions";

export function OcrProcessingNotice() {
  return <div className="space-y-3 text-sm text-text-secondary">
    <p>Alliance Command Center sends the screenshots you choose to Google Cloud to read names, scores and other visible text for your review.</p>
    <p>Prepared screenshots and recognized text are stored privately for up to 30 days from upload, then scheduled for deletion. Upload history remains. Only share screenshots you are allowed to provide.</p>
    <p>This choice applies to your account across devices and alliances. You can turn it off in Settings. That stops screenshot uploads and retries; manual entry, spreadsheets and saved score history remain available where you have access.</p>
  </div>;
}

/** Blocks file selection before any upload. Server enforcement is independent. */
export function OcrConsentGate({ initial, children }: { initial: OcrConsentState; children: ReactNode }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const result = await refreshOcrConsent();
        if (!active) return;
        if (result.consent) { setState(result.consent); setError(""); router.refresh(); }
        else setError(result.error!);
      } catch { if (active) setError("Your permission could not be checked. Reload before continuing."); }
    };
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("acc-ocr-preferences") : null;
    if (channel) channel.onmessage = refresh;
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => { active = false; channel?.close(); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [router]);
  async function choose(granted: boolean) {
    setBusy(true); setError("");
    try {
      const result = await updateOcrConsent({ purpose: "PROCESSING", granted, expectedId: state.processing?.id ?? null, noticeVersion: OCR_PROCESSING_NOTICE });
      if (result.consent) { setState(result.consent); router.refresh(); }
      else setError(result.error!);
    } catch { setError("Your preference could not be saved. Reload to check it before trying again."); }
    finally { setBusy(false); }
  }
  if (processingAllowed(state) && !error) {
    if (state.processing?.id !== initial.processing?.id) return <Card><p role="status">Opening screenshots with your saved preference…</p></Card>;
    return <>{children}</>;
  }
  const firstUse = state.processing === null;
  return <Card><div className="max-w-2xl space-y-5" data-testid="ocr-consent-gate">
    <h2 className="text-xl font-semibold">{firstUse ? "Before your first screenshot" : "Screenshots are disabled"}</h2>
    {firstUse ? <><OcrProcessingNotice /><div className="flex flex-wrap gap-3">
      <Button disabled={busy} onClick={() => choose(true)}>Allow OCR processing</Button>
      <Button variant="secondary" disabled={busy} onClick={() => choose(false)}>Decline</Button>
    </div></> : <><p className="text-text-secondary">Review OCR processing in your account Settings to enable screenshots. You can continue using manual entry or spreadsheets where you have access.</p>
      <Button href="/account/ocr" variant="secondary">Open OCR Settings</Button></>}
    {error && <p role="alert" className="text-sm text-danger-light">{error}</p>}
  </div></Card>;
}
