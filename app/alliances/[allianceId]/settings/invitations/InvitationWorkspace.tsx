"use client";

import { useState } from "react";
import { Card } from "@/app/src/components";
import { InviteCollaboratorForm } from "./InviteCollaboratorForm";
import { PendingInvitations, type PendingInvitation } from "./PendingInvitations";

export function InvitationWorkspace({ allianceId, invitations }: { allianceId: string; invitations: PendingInvitation[] }) {
  const [creationView, setCreationView] = useState(0);
  // Renewal/cancellation can retire the credentials shown by the creation
  // card. Clear that sibling result as soon as either operation begins.
  const clearCreationResult = () => setCreationView((view) => view + 1);
  return <div className="flex flex-col gap-8">
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-secondary">Invite Collaborator</h2>
      <Card><Card.Body><InviteCollaboratorForm key={creationView} allianceId={allianceId} /></Card.Body></Card>
    </section>
    <section>
      <h2 className="mb-3 text-sm font-medium uppercase tracking-wide text-text-secondary">Pending Invitations</h2>
      <Card><Card.Body><PendingInvitations allianceId={allianceId} invitations={invitations} onInvitationChanged={clearCreationResult} /></Card.Body></Card>
    </section>
  </div>;
}
