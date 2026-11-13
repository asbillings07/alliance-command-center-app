"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/app/src/components/client";
import { ConfirmDialog } from "@/app/src/components/ConfirmDialog";
import { saveIdentityDecision } from "./actions";

export function IdentityReviewForm({ allianceId, memberId, reviewKey, canConfirm, canRevoke, playerName }: {
  allianceId: string; memberId: string; reviewKey: string;
  canConfirm: boolean; canRevoke: boolean; playerName: string;
}) {
  const [acknowledgedKey, setAcknowledgedKey] = useState<string | null>(null);
  const [decision, setDecision] = useState<{ kind: "confirm" | "revoke"; reviewKey: string } | null>(null);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, setPending] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);
  const acknowledged = acknowledgedKey === reviewKey;
  const openDecision = decision?.reviewKey === reviewKey ? decision.kind : null;
  useEffect(() => { if (result && openDecision === null) status.current?.focus(); }, [result, openDecision]);
  async function apply() {
    if (openDecision === null) return { error: "The identity details changed. Reload and review them again." };
    const confirm = openDecision === "confirm";
    setPending(true);
    try {
      const saved = await saveIdentityDecision(allianceId, memberId, { reviewKey, confirm, acknowledged: confirm ? acknowledged : true });
      if (!saved.ok) return { error: saved.message };
      setResult(saved);
    } catch {
      return { error: "The response was interrupted. Reload and check the decision history before trying again." };
    } finally { setPending(false); }
  }
  return <div className="space-y-4">
    <div aria-live="polite">
      {result && <p ref={status} tabIndex={-1} className={`rounded-lg border p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary ${result.ok ? "border-success text-success-light" : "border-danger text-danger-light"}`}>{result.message}</p>}
    </div>
    {canConfirm && <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm text-text-secondary">
      <input type="checkbox" checked={acknowledged} onChange={(event) => setAcknowledgedKey(event.target.checked ? reviewKey : null)} disabled={pending}
        className="mt-1 size-5 shrink-0 accent-primary focus:ring-2 focus:ring-primary" />
      <span>I verified this person&apos;s current in-game name, alliance/server and ownership of the linked account through an established contact.</span>
    </label>}
    <div className="flex flex-col gap-3 sm:flex-row">
      {canConfirm && <Button disabled={!acknowledged || pending} onClick={() => { setResult(null); setDecision({ kind: "confirm", reviewKey }); }} size="lg">Confirm identity</Button>}
      {canRevoke && <Button variant="secondary" disabled={pending} onClick={() => { setResult(null); setDecision({ kind: "revoke", reviewKey }); }} size="lg">Revoke confirmation</Button>}
      {pending && <span role="status" className="self-center text-sm text-text-muted">Saving decision…</span>}
    </div>
    <ConfirmDialog isOpen={openDecision !== null} onClose={() => setDecision(null)} onConfirm={apply}
      title={openDecision === "confirm" ? "Confirm this member's identity?" : "Revoke this confirmation?"}
      description={openDecision === "confirm"
        ? `Record that you verified ${playerName} and the displayed linked account? This records your name and decision. It does not change account permissions or enable screenshot uploads.`
        : `Revoke the identity confirmation for ${playerName}? A new review will be required. Existing account access and metric history stay unchanged.`}
      confirmLabel={openDecision === "confirm" ? "Yes, confirm identity" : "Yes, revoke confirmation"} />
  </div>;
}
