"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/app/src/components/client";
import { ConfirmDialog } from "@/app/src/components/ConfirmDialog";
import { saveMemberAccess } from "./actions";

// Keep server-rendered controls disabled until their confirmation handlers exist.
const subscribe = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function MemberAccessForm({ allianceId, memberId, reviewKey, canGrant, canRevoke, accountLabel, playerName, previousAccount, previousName }: {
  allianceId: string; memberId: string; reviewKey: string; canGrant: boolean; canRevoke: boolean;
  accountLabel: string; playerName: string; previousAccount?: string; previousName?: string;
}) {
  const ready = useSyncExternalStore(subscribe, clientReady, serverReady);
  const [proposal, setProposal] = useState<{ key: string; grant: boolean } | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const status = useRef<HTMLParagraphElement>(null);
  const current = proposal?.key === reviewKey ? proposal : null;
  useEffect(() => { if (message) status.current?.focus(); }, [message]);
  async function apply() {
    if (!current) return { error: "Details changed. Reload and review this decision." };
    try {
      const result = await saveMemberAccess(allianceId, memberId, { reviewKey: current.key, grant: current.grant, acknowledged: true });
      if (!result.ok) return { error: result.message };
      setMessage(result.message);
      setProposal(null);
    } catch {
      return { error: "The response was interrupted. Reload and check access history before trying again." };
    }
  }
  return <div className="space-y-4">
    {message && <p ref={status} tabIndex={-1} role="status" className="rounded-lg border border-success p-3 text-sm text-success-light focus:outline-none focus:ring-2 focus:ring-primary">{message}</p>}
    <div className="flex flex-col gap-3 sm:flex-row">
      {canGrant && <Button disabled={!ready} onClick={() => { setMessage(null); setProposal({ key: reviewKey, grant: true }); }}>Approve member access</Button>}
      {canRevoke && <Button disabled={!ready} variant="warning" onClick={() => { setMessage(null); setProposal({ key: reviewKey, grant: false }); }}>Revoke member access</Button>}
    </div>
    <ConfirmDialog isOpen={current !== null} onClose={() => setProposal(null)} onConfirm={apply}
      title={current?.grant ? "Approve access to this member record?" : "Revoke this member's access?"}
      description={current?.grant
        ? `Allow ${accountLabel} to view the in-game name and alliance/server for ${playerName}? This does not grant access to other members, leadership notes or reports, enable uploads, or change any existing collaborator permissions. No email is sent.`
        : `Remove the earlier member-access approval for ${previousAccount || "the linked account"} → ${previousName || playerName}? Their next request to this member record will be denied. Existing collaborator access, account sign-in and historical records remain unchanged. No email is sent.`}
      confirmLabel={current?.grant ? "Yes, approve member access" : "Yes, revoke member access"} />
  </div>;
}
