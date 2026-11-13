"use client";

import { useEffect, useRef, useState } from "react";
import { Button, Input, Label } from "@/app/src/components/client";
import { ConfirmDialog } from "@/app/src/components/ConfirmDialog";
import { saveIdentityName } from "./actions";

type NameDraft = { reviewKey: string; playerName: string };

export function IdentityNameForm({ allianceId, memberId, reviewKey, playerName }: {
  allianceId: string; memberId: string; reviewKey: string; playerName: string;
}) {
  const [draft, setDraft] = useState<NameDraft | null>(null);
  const [proposal, setProposal] = useState<NameDraft | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const editing = draft?.reviewKey === reviewKey ? draft : null;
  const proposed = proposal?.reviewKey === reviewKey ? proposal : null;
  useEffect(() => { if (message) status.current?.focus(); }, [message]);

  async function apply() {
    if (!proposed) return { error: "The identity details changed. Reload and review them again." };
    setPending(true);
    try {
      const result = await saveIdentityName(allianceId, memberId, { ...proposed, acknowledged: true });
      if (!result.ok) return { error: result.message };
      setDraft(null);
      setProposal(null);
      setMessage(result.message);
    } catch {
      return { error: "The response was interrupted. Reload and check the current name and identity history before trying again." };
    } finally { setPending(false); }
  }

  return <div className="mt-4 space-y-4">
    {message && <p ref={status} tabIndex={-1} role="status" className="rounded-lg border border-success p-3 text-sm text-success-light focus:outline-none focus:ring-2 focus:ring-primary">{message}</p>}
    {editing ? <form className="space-y-3 rounded-lg border border-border p-4" onSubmit={(event) => {
      event.preventDefault();
      setProposal({ reviewKey, playerName: editing.playerName.trim() });
    }}>
      <Label htmlFor="identity-player-name">Current in-game name</Label>
      <Input id="identity-player-name" name="playerName" value={editing.playerName} required maxLength={200}
        disabled={pending} autoComplete="off" aria-describedby="identity-name-help"
        onChange={(event) => setDraft({ reviewKey, playerName: event.target.value })} />
      <p id="identity-name-help" className="text-sm text-text-muted">Use the member&apos;s current name in the game. Saving a change requires a fresh identity confirmation.</p>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Button type="submit" disabled={pending || !editing.playerName.trim() || editing.playerName.trim() === playerName}>Review name change</Button>
        <Button type="button" variant="secondary" disabled={pending} onClick={() => setDraft(null)}>Cancel editing</Button>
      </div>
    </form> : <Button type="button" variant="secondary" onClick={() => {
      setMessage(null); setDraft({ reviewKey, playerName });
    }}>Edit in-game name</Button>}
    <ConfirmDialog isOpen={proposed !== null} onClose={() => setProposal(null)} onConfirm={apply}
      title="Update this member's in-game name?"
      description={`Change “${playerName || "Not recorded"}” to “${proposed?.playerName ?? ""}”? This updates the member record, records who changed the name, and clears any identity confirmation. You must review and confirm the identity again. The linked account, account permissions and metric history stay unchanged.`}
      confirmLabel="Yes, update in-game name" />
  </div>;
}
