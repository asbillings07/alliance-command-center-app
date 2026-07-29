"use client";

import { useState, useTransition } from "react";
import { Badge } from "@/app/src/components";
import {
  fetchPriorAttemptsAction,
  type PriorAttemptsResult,
} from "./actions";
import type {
  BetaAttentionReason,
  BetaAttemptOperator,
  BetaInvitationAttemptRecord,
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

const PRIOR_ATTEMPTS_PAGE_SIZE = 10;

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

function formatOperatorLabel(
  operator: BetaAttemptOperator | null,
  action: string,
): string {
  if (!operator?.userId) {
    return `${action}: Unknown (legacy)`;
  }

  const name = operator.displayName ?? operator.email ?? operator.userId;
  return `${action}: ${name}`;
}

function AttemptAuditDetails({
  attempt,
}: {
  attempt: BetaInvitationAttemptRecord;
}) {
  const config = statusConfig[attempt.status];

  return (
    <div className="text-xs text-text-muted space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-primary">{attempt.email}</span>
        <Badge variant={config.variant} size="sm">
          {config.label}
        </Badge>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>Issued {formatDateTime(attempt.issuedAt)}</span>
        <span>Expires {formatDateTime(attempt.expiresAt)}</span>
        {attempt.acceptedAt && (
          <span>Accepted {formatDateTime(attempt.acceptedAt)}</span>
        )}
        {attempt.revokedAt && (
          <span>Revoked {formatDateTime(attempt.revokedAt)}</span>
        )}
        {attempt.campaign && <span>Wave: {attempt.campaign}</span>}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <span>{formatOperatorLabel(attempt.issuedBy, "Issued by")}</span>
        {attempt.status === "revoked" && (
          <span>{formatOperatorLabel(attempt.revokedBy, "Revoked by")}</span>
        )}
        {attempt.status === "accepted" && (
          <span>{formatOperatorLabel(attempt.acceptedBy, "Accepted by")}</span>
        )}
      </div>
      {attempt.notes ? (
        <p className="italic">{attempt.notes}</p>
      ) : (
        <p className="text-text-disabled">Notes: —</p>
      )}
    </div>
  );
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
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  if (priorAttemptCount === 0) {
    return null;
  }

  const loadPage = (page: number) => {
    startTransition(async () => {
      const response = await fetchPriorAttemptsAction(
        participantId,
        page,
        PRIOR_ATTEMPTS_PAGE_SIZE,
      );
      if (response.success) {
        setResult(response);
        setCurrentPage(response.page);
        setError(null);
      } else {
        setError(response.error);
      }
    });
  };

  const handleToggle = () => {
    if (open) {
      setOpen(false);
      return;
    }

    setOpen(true);
    if (result?.success) {
      return;
    }

    loadPage(1);
  };

  const totalPages =
    result?.success && result.pageSize > 0
      ? Math.max(1, Math.ceil(result.total / result.pageSize))
      : Math.max(1, Math.ceil(priorAttemptCount / PRIOR_ATTEMPTS_PAGE_SIZE));

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

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
        <div className="mt-2 pl-3 border-l-2 border-border space-y-3">
          {isPending && !result && (
            <p className="text-xs text-text-muted">Loading history…</p>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          {result?.success &&
            result.items.map((attempt) => (
              <AttemptAuditDetails key={attempt.id} attempt={attempt} />
            ))}
          {result?.success && totalPages > 1 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => loadPage(currentPage - 1)}
                disabled={!canGoPrevious || isPending}
                className="text-xs text-primary hover:text-primary-hover disabled:text-text-disabled disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <span className="text-xs text-text-muted">
                Page {currentPage} of {totalPages}
              </span>
              <button
                type="button"
                onClick={() => loadPage(currentPage + 1)}
                disabled={!canGoNext || isPending}
                className="text-xs text-primary hover:text-primary-hover disabled:text-text-disabled disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          )}
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
      </div>
      <div className="mt-1 text-xs text-text-muted flex flex-wrap gap-x-3 gap-y-1">
        <span>Issued {formatDateTime(attempt.issuedAt)}</span>
        <span>Expires {formatDateTime(attempt.expiresAt)}</span>
        {attempt.acceptedAt && (
          <span>Accepted {formatDateTime(attempt.acceptedAt)}</span>
        )}
        {attempt.revokedAt && (
          <span>Revoked {formatDateTime(attempt.revokedAt)}</span>
        )}
        {attempt.campaign && <span>Wave: {attempt.campaign}</span>}
      </div>
      <div className="mt-1 text-xs text-text-muted flex flex-wrap gap-x-3 gap-y-1">
        <span>{formatOperatorLabel(attempt.issuedBy, "Issued by")}</span>
        {attempt.status === "revoked" && (
          <span>{formatOperatorLabel(attempt.revokedBy, "Revoked by")}</span>
        )}
        {attempt.status === "accepted" && (
          <span>{formatOperatorLabel(attempt.acceptedBy, "Accepted by")}</span>
        )}
      </div>
      {attempt.notes ? (
        <p className="text-xs text-text-muted italic mt-1">{attempt.notes}</p>
      ) : (
        <p className="text-xs text-text-disabled mt-1">Notes: —</p>
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
  formatOperatorLabel,
  AttemptAuditDetails,
};

export type { BetaInvitationAttemptStatus };
