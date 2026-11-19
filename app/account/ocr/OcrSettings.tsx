"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card, Badge } from "@/app/src/components";
import { Button, ConfirmDialog } from "@/app/src/components/client";
import { LocalTimestamp } from "@/app/alliances/[allianceId]/screenshots/LocalTimestamp";
import { OCR_PROCESSING_NOTICE, OCR_QUALITY_NOTICE, processingAllowed, qualityAllowed, type OcrConsentState } from "@/app/src/lib/ocr/consentPolicy";
import { OcrProcessingNotice } from "./OcrConsentGate";
import { updateOcrConsent } from "./actions";

export function OcrSettings({ initial, canEnable = true }: { initial: OcrConsentState; canEnable?: boolean }) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [dialog, setDialog] = useState<"processing-on" | "processing-off" | "quality-on" | "quality-off" | null>(null);
  const [message, setMessage] = useState("");
  const processing = processingAllowed(state); const quality = qualityAllowed(state);
  async function save() {
    const isProcessing = dialog?.startsWith("processing");
    const choice = isProcessing ? state.processing : state.quality;
    const result = await updateOcrConsent({ purpose: isProcessing ? "PROCESSING" : "QUALITY_REVIEW", granted: dialog?.endsWith("-on") === true,
      expectedId: choice?.id ?? null, noticeVersion: isProcessing ? OCR_PROCESSING_NOTICE : OCR_QUALITY_NOTICE });
    if (!result.consent) return { error: result.error };
    setState(result.consent); setMessage("Your OCR preferences are saved for this account.");
    const channel = typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("acc-ocr-preferences") : null;
    channel?.postMessage("changed"); channel?.close(); router.refresh();
  }
  return <div className="space-y-6" data-testid="ocr-settings">
    <Card><Card.Header>OCR processing</Card.Header><Card.Body><div className="space-y-4">
      <Badge variant={processing ? "info" : "neutral"}>{processing ? "Screenshots enabled" : "Screenshots disabled"}</Badge>
      <OcrProcessingNotice />
      <p className="text-sm text-text-secondary">Turning this off cannot recall an image already sent. Retained sources keep their original expiry. Your existing alliance access and the protected trial limits still apply.</p>
      {state.processing && <p className="text-xs text-text-muted">Last choice: <LocalTimestamp value={state.processing.createdAt} /></p>}
      <Button variant="secondary" disabled={!canEnable && !processing} onClick={() => setDialog(processing ? "processing-off" : "processing-on")}>{processing ? "Turn off OCR processing" : "Enable OCR processing"}</Button>
    </div></Card.Body></Card>
    <Card><Card.Header>Human quality review</Card.Header><Card.Body><div className="space-y-4">
      <Badge variant={quality ? "info" : "neutral"}>{quality ? "Optional review enabled" : "Off"}</Badge>
      <p className="text-sm text-text-secondary">Optional. Allow authorized quality reviewers to inspect a small sample of your future screenshots and recognition results to check accuracy. This is separate from your alliance&apos;s normal import review.</p>
      <p className="text-sm text-text-secondary">Off by default. It does not affect your ability to use OCR. Existing screenshots are not included when you enable it. Sources keep the same 30-day expiry; choosing them for review does not extend it.</p>
      <p className="text-sm text-text-secondary">Turning this off stops further quality-review access to your sources. It cannot undo a review already completed. Turning it on again covers future uploads only.</p>
      {state.quality && <p className="text-xs text-text-muted">Last choice: <LocalTimestamp value={state.quality.createdAt} /></p>}
      <Button variant="secondary" disabled={!canEnable && !quality} onClick={() => setDialog(quality ? "quality-off" : "quality-on")}>{quality ? "Turn off human quality review" : "Enable human quality review"}</Button>
    </div></Card.Body></Card>
    <p role="status" className="text-sm text-text-secondary">{message}</p>
    <ConfirmDialog isOpen={dialog !== null}
      title={dialog === "processing-off" ? "Turn off screenshot processing?" : dialog === "processing-on" ? "Allow OCR processing?" : dialog === "quality-on" ? "Allow optional human quality review?" : "Stop human quality review?"}
      description={<p className="text-sm text-text-secondary">{dialog === "processing-off"
        ? "New screenshot uploads, retries and unfinished screenshot reviews will be disabled across your account. Already sent processing cannot be recalled. Manual entry, spreadsheets and saved score history remain available where you have access."
        : dialog === "processing-on" ? "I allow ACC and Google Cloud to process the screenshots I choose under the notice above, with private 30-day source retention. This does not change my optional quality-review preference."
        : dialog === "quality-on" ? "I allow authorized quality reviewers to inspect a small sample of my future screenshots for accuracy. Older uploads remain excluded. This is optional and does not extend source retention."
        : "Further quality-review access to your sources will stop. OCR processing will stay as you have set it. Completed reviews cannot be undone."}</p>}
      confirmLabel={dialog?.endsWith("-on") ? "Allow" : "Turn off"} onConfirm={save} onClose={() => setDialog(null)} />
  </div>;
}
