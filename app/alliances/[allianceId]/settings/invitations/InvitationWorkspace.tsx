"use client";

import { useState } from "react";
import { Card } from "@/app/src/components";
import { InviteCollaboratorForm } from "./InviteCollaboratorForm";
import { PendingInvitations, type PendingInvitation } from "./PendingInvitations";

export function InvitationWorkspace({ allianceId, invitations }: { allianceId: string; invitations: PendingInvitation[] }) {
  const [invalidatedShareIds, setInvalidatedShareIds] = useState<string[]>([]);
  // Renewal/cancellation can retire the credentials shown by the creation
  // card. Invalidate only that share result, preserving drafts and pending
  // creation requests, including a response that arrives after invalidation.
  const clearCreationResult = (id: string) => setInvalidatedShareIds((ids) => ids.includes(id) ? ids : [...ids, id]);
  return <div className="flex flex-col gap-8">
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-secondary">Invite Collaborator</h2>
      <Card><Card.Body><InviteCollaboratorForm allianceId={allianceId} invalidatedShareIds={invalidatedShareIds} /></Card.Body></Card>
    </section>
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-secondary">Pending Invitations</h2>
      <Card><Card.Body><PendingInvitations allianceId={allianceId} invitations={invitations} onInvitationChanged={clearCreationResult} /></Card.Body></Card>
    </section>
  </div>;
}
