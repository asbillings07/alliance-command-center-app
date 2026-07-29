"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/app/src/components";
import {
  fetchPriorAttemptsAction,
  type PriorAttemptsResult,
} from "./actions";
import type {
  BetaAttentionReason,
  BetaInvitationAttemptStatus,
  BetaJourneyStage,
  BetaParticipantListItem,
} from "@/app/src/lib/platform/betaParticipants";
import { InvitationActions, InvitationCardActions } from "./InvitationActions";

const journeyStageLabels: Record<BetaJourneyStage, string> = {
  invited: "Invited",
  accepted: "Accepted",
  alliance_created: "Alliance created",
  roster_imported: "Roster imported",
  first_dataset_recorded: "First dataset recorded",
  setup_complete: "Setup complete",
};

const attentionLabels: Record<BetaAttentionReason, string> = {
  invitation_expired: "Invitation expired",
  invitation_pending_stale: "Pending too long",
  accepted_no_alliance: "No alliance yet",
  setup_stalled: "Setup stalled",
};

const statusConfig = {
  pending: { variant: "info" as const, label: "Pending" },
  accepted: { variant: "success" as const, label: "Accepted" },
  expired: { variant: "danger" as const, label: "Expired" },
  revoked: { variant: "warning" as const, label: "Revoked" },
};

function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AttentionBadge({
  reason,
  since,
}: {
  reason: BetaAttentionReason;
  since: Date | string;
}) {
  return (
    <Badge variant="warning" size="sm">
      {attentionLabels[reason]} · since {formatDateTime(since)}
    </Badge>
  );
}

function PriorAttemptsDisclosure({
  participantId,
  priorAttemptCount,
}: {
  participantId: string;
  priorAttemptCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<PriorAttemptsResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (priorAttemptCount === 0) {
    return null;
  }

  const handleToggle = () => {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);
    if (result) {
      return;
    }

    startTransition(async () => {
      const response = await fetchPriorAttemptsAction(participantId, 1, 10);
      if (response.success) {
        setResult(response);
        setError(null);
      } else {
        setError(response.error);
      }
    });
  };

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleToggle}
        className="text-xs text-primary hover:text-primary-hover"
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} {priorAttemptCount} prior attempt
        {priorAttemptCount === 1 ? "" : "s"}
      </button>
      {open && (
        <div className="mt-2 pl-3 border-l-2 border-border space-y-2">
          {isPending && !result && (
            <p className="text-xs text-text-muted">Loading history…</p>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          {result?.success &&
            result.items.map((attempt) => {
              const config = statusConfig[attempt.status];
              return (
                <div key={attempt.id} className="text-xs text-text-muted">
                  <span className="text-text-primary">{attempt.email}</span>
                  {" · "}
                  <Badge variant={config.variant} size="sm">
                    {config.label}
                  </Badge>
                  {" · "}
                  Sent {formatDate(attempt.issuedAt)}
                  {attempt.campaign && ` · Wave: ${attempt.campaign}`}
                </div>
              );
            })}
        </div>
      )}
    </div>
  );
}

function LatestAttemptBlock({
  item,
  variant,
}: {
  item: BetaParticipantListItem;
  variant: "card" | "row";
}) {
  const attempt = item.latestAttempt;
  const config = statusConfig[attempt.status];

  const actions =
    attempt.status === "pending" ? (
      variant === "card" ? (
        <InvitationCardActions
          invitationId={attempt.id}
          code={attempt.code}
          inviteUrl={attempt.inviteUrl}
        />
      ) : (
        <InvitationActions
          invitationId={attempt.id}
          code={attempt.code}
          inviteUrl={attempt.inviteUrl}
        />
      )
    ) : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-text-primary">{attempt.email}</span>
        <Badge variant={config.variant} size="sm">
          {config.label}
        </Badge>
        <span className="text-text-muted">
          Sent {formatDate(attempt.issuedAt)}
        </span>
        {attempt.campaign && (
          <span className="text-text-muted">Wave: {attempt.campaign}</span>
        )}
      </div>
      {attempt.notes && (
        <p className="text-xs text-text-muted italic mt-1">{attempt.notes}</p>
      )}
      {actions}
      <PriorAttemptsDisclosure
        participantId={item.participantId}
        priorAttemptCount={item.priorAttemptCount}
      />
    </div>
  );
}

function ParticipantIdentity({ item }: { item: BetaParticipantListItem }) {
  const name = item.displayName ?? item.latestAttempt.email;
  return (
    <div>
      <div className="font-medium text-text-primary flex flex-wrap items-center gap-2">
        <span>{name}</span>
        {item.identityAmbiguous && (
          <Badge variant="warning" size="sm">
            Identity ambiguous
          </Badge>
        )}
        {item.allianceAmbiguous && (
          <Badge variant="warning" size="sm">
            Alliance ambiguous
          </Badge>
        )}
      </div>
      {item.currentEmail && item.currentEmail !== item.latestAttempt.email && (
        <p className="text-xs text-text-muted">{item.currentEmail}</p>
      )}
    </div>
  );
}

export function ParticipantCard({ item }: { item: BetaParticipantListItem }) {
  return (
    <div className="bg-surface-secondary rounded-lg border border-border p-4">
      <ParticipantIdentity item={item} />
      <div className="mt-2 flex flex-wrap gap-2">
        <Badge variant="info" size="sm">
          {journeyStageLabels[item.journeyStage]}
        </Badge>
        {item.wave && (
          <Badge variant="neutral" size="sm">
            Wave: {item.wave}
          </Badge>
        )}
        {item.attentionReason && item.attentionSince && (
          <AttentionBadge
            reason={item.attentionReason}
            since={item.attentionSince}
          />
        )}
      </div>
      <div className="mt-3 pt-3 border-t border-border">
        <LatestAttemptBlock item={item} variant="card" />
      </div>
    </div>
  );
}

export function ParticipantTableRow({ item }: { item: BetaParticipantListItem }) {
  return (
    <tr className="border-b border-border hover:bg-surface-secondary transition-colors align-top">
      <td className="py-3 px-4">
        <ParticipantIdentity item={item} />
      </td>
      <td className="py-3 px-4 text-text-muted">{item.wave ?? "—"}</td>
      <td className="py-3 px-4">
        <Badge variant="info" size="sm">
          {journeyStageLabels[item.journeyStage]}
        </Badge>
      </td>
      <td className="py-3 px-4">
        {item.attentionReason && item.attentionSince ? (
          <AttentionBadge
            reason={item.attentionReason}
            since={item.attentionSince}
          />
        ) : (
          <span className="text-text-disabled">—</span>
        )}
      </td>
      <td className="py-3 px-4">
        <LatestAttemptBlock item={item} variant="row" />
      </td>
    </tr>
  );
}

export {
  journeyStageLabels,
  attentionLabels,
  formatDate,
  formatDateTime,
};

export type { BetaInvitationAttemptStatus };
