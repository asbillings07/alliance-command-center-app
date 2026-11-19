"use client";
import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { LocalTimestamp } from "./LocalTimestamp";
import { Button, ConfirmDialog } from "@/app/src/components/client";
import type { loadQaAllianceSettings } from "@/app/src/lib/ocr/qaAlliance";
import { saveQaAllianceName } from "./qa-actions";

export type QaAllianceSettingsData = Awaited<ReturnType<typeof loadQaAllianceSettings>>;

export function QaAllianceSettings({ allianceId, initial, disabled }: { allianceId: string; initial: QaAllianceSettingsData; disabled: boolean }) {
  const router = useRouter(); const inputId = useId();
  const [name, setName] = useState(initial.name); const [confirm, setConfirm] = useState(false);
  return <details className="rounded-xl border border-border bg-surface p-4">
    <summary className="cursor-pointer font-semibold text-primary-light">Edit QA alliance name</summary>
    <p className="mt-3 text-sm text-text-secondary">Test setup only · Server {initial.server}. This changes the isolated QA alliance, with no effect on the live site. Use the alliance tag or name shown in your screenshots.</p>
    <label htmlFor={inputId} className="mt-4 block text-sm font-medium">QA alliance name</label>
    <input id={inputId} value={name} maxLength={200} disabled={disabled || confirm} onChange={event => setName(event.target.value)}
      className="mt-2 w-full rounded-lg border border-border bg-background p-3 text-text-primary focus:outline-2 focus:outline-primary" />
    <p className="mt-2 text-sm text-text-secondary">Earlier scans keep their original names. After saving, select your screenshot again for a fresh review.</p>
    <p className="mt-2 text-sm text-text-secondary">QA only: each new scan or retry reserves $0.01 from the existing $5 trial cap, including failed attempts and alliance mismatches. Reopening completed scans does not make a new OCR request. These are internal evaluation costs, not user charges.</p>
    {disabled && <p className="mt-2 text-sm text-warning-light">Wait for the current screenshot check to finish before editing the name.</p>}
    <div className="mt-4"><Button variant="secondary" disabled={disabled || !name.trim() || name.trim() === initial.name}
      onClick={() => setConfirm(true)}>Review QA name change</Button></div>
    {initial.history.length > 0 && <div className="mt-5"><h2 className="font-medium">QA name history</h2>
      <ol className="mt-2 space-y-2 text-sm text-text-secondary">{initial.history.map(change => <li key={change.id} className="break-words">
        <span>{change.previousName} → {change.name}</span><br /><span>{change.actorName} · <LocalTimestamp value={change.createdAt} /></span>
      </li>)}</ol></div>}
    <ConfirmDialog isOpen={confirm} onClose={() => setConfirm(false)} title="Change this QA alliance name?" confirmLabel="Save QA name" pendingLabel="Saving QA name…"
      description={<div className="space-y-3 break-words"><p><strong>Current:</strong> {initial.name}<br /><strong>New:</strong> {name.trim()}</p>
        <p>This clears the current screenshot review. Historical scans and their original names remain unchanged. No screenshot is processed automatically, and the trial allowance is not reset.</p>
        <p>Member identity confirmations and approved own-record access may need fresh leadership review after the name changes. The live alliance is unchanged.</p></div>}
      onConfirm={async () => { const result = await saveQaAllianceName(allianceId, name, initial.identityVersion, true); if (result.error) return result; router.refresh(); }} />
  </details>;
}
