"use client";

import { useState, useTransition } from "react";
import { Badge, type BadgeVariant } from "@/app/src/components";
import {
  fetchPriorAttemptsAction,
  fetchDeliveryHistoryAction,
  type PriorAttemptsResult,
  type DeliveryHistoryResult,
} from "./actions";
import type {
  BetaAttentionReason,
  BetaAttemptOperator,
  BetaInvitationAttemptRecord,
  BetaInvitationAttemptStatus,
  BetaInvitationDeliveryOutcome,
  BetaInvitationDeliveryTrigger,
  BetaInvitationDeliverySummary,
  BetaJourneyStage,
  BetaParticipantListItem,
} from "@/app/src/lib/platform/betaParticipants";
import { InvitationActions, InvitationCardActions } from "./InvitationActions";
import { ReissueActions } from "./ReissueActions";

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

/** Distinct from statusConfig above (#175): invitation lifecycle vs. email delivery are different questions. */
const deliveryStatusConfig: Record<
  BetaInvitationDeliveryOutcome,
  { variant: BadgeVariant; label: string }
> = {
  sent: { variant: "success", label: "Sent" },
  failed: { variant: "danger", label: "Failed" },
  skipped: { variant: "neutral", label: "Skipped" },
};

const deliveryTriggerLabels: Record<BetaInvitationDeliveryTrigger, string> = {
  issue: "Initial send",
  resend: "Resend",
  reissue: "Reissue",
};

const PRIOR_ATTEMPTS_PAGE_SIZE = 10;
const DELIVERY_HISTORY_PAGE_SIZE = 10;

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

/**
 * Formats the attempted-by actor for one delivery attempt (#175).
 * Deliberately distinct from `formatOperatorLabel` above: that helper
 * gates on `userId` being present, which is correct for invitation
 * lifecycle operators (a null userId there really can mean a genuine,
 * pre-attribution legacy gap). Delivery attempts are different —
 * attemptedByEmail is snapshotted and required on every row, and
 * onDelete: SetNull only clears attemptedByUserId, so a deleted
 * operator's email/displayName survive and must still be shown. A
 * fully-missing actor here is a defensive/never-in-practice case, not a
 * real legacy gap (this table postdates #175).
 */
function formatDeliveryActorLabel(actor: BetaAttemptOperator | null): string {
  if (!actor?.displayName && !actor?.email) {
    return "By: Unknown (legacy)";
  }

  return `By: ${actor.displayName ?? actor.email}`;
}

/**
 * Latest email delivery outcome for one invitation attempt (#175).
 * Deliberately separate from `statusConfig` above — invitation lifecycle
 * (pending/accepted/expired/revoked) and email-delivery outcome
 * (sent/failed/skipped/not recorded) are different questions.
 */
function DeliveryStatusSummary({
  delivery,
}: {
  delivery: BetaInvitationDeliverySummary | null;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-text-muted">
      <span>Email:</span>
      {delivery ? (
        <>
          <Badge variant={deliveryStatusConfig[delivery.status].variant} size="sm">
            {deliveryStatusConfig[delivery.status].label}
          </Badge>
          <span>{deliveryTriggerLabels[delivery.trigger]}</span>
          <span>{formatDateTime(delivery.createdAt)}</span>
          {/* min-w-0 break-all: the snapshotted email fallback can be an
              arbitrarily long unbroken string, which would otherwise force
              this flex item to its min-content width and overflow the card
              on narrow viewports. */}
          <span className="min-w-0 break-all">
            {formatDeliveryActorLabel(delivery.attemptedBy)}
          </span>
          {/* Provider message IDs are only ever queried/rendered from this
              already-platform-admin-gated surface, and only ever set on
              SENT rows (see canonicalization mapping in
              recordBetaInvitationDeliveryAttempt). They're an opaque
              provider-assigned string up to 200 chars with no natural break
              points, so this is a full-width, breakable row rather than an
              inline flex item — otherwise it would force horizontal
              overflow on narrow viewports. */}
          {delivery.status === "sent" && delivery.providerMessageId && (
            <span className="basis-full min-w-0 break-all text-text-disabled">
              Provider ID: {delivery.providerMessageId}
            </span>
          )}
          {delivery.status === "failed" && delivery.failureReason && (
            <span className="text-danger basis-full">
              {delivery.failureReason}
            </span>
          )}
        </>
      ) : (
        <Badge variant="neutral" size="sm">
          Not recorded
        </Badge>
      )}
    </div>
  );
}

function DeliveryHistoryDisclosure({ invitationId }: { invitationId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<DeliveryHistoryResult | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [error, setError] = useState<string | null>(null);

  const loadPage = (page: number) => {
    startTransition(async () => {
      const response = await fetchDeliveryHistoryAction(
        invitationId,
        page,
        DELIVERY_HISTORY_PAGE_SIZE,
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
      : 1;

  const canGoPrevious = currentPage > 1;
  const canGoNext = currentPage < totalPages;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={handleToggle}
        className="text-xs text-primary hover:text-primary-hover"
        aria-expanded={open}
      >
        {open ? "Hide" : "Show"} email delivery history
      </button>
      {open && (
        <div className="mt-2 pl-3 border-l-2 border-border space-y-2">
          {isPending && !result && (
            <p className="text-xs text-text-muted">Loading delivery history…</p>
          )}
          {error && <p className="text-xs text-danger">{error}</p>}
          {result?.success && result.items.length === 0 && (
            <p className="text-xs text-text-disabled">Not recorded</p>
          )}
          {result?.success &&
            result.items.map((delivery) => (
              <DeliveryStatusSummary key={delivery.id} delivery={delivery} />
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
      <DeliveryStatusSummary delivery={attempt.latestDeliveryAttempt} />
      {attempt.latestDeliveryAttempt && (
        <DeliveryHistoryDisclosure invitationId={attempt.id} />
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

  const pendingActions =
    attempt.status === "pending" ? (
      variant === "card" ? (
        <InvitationCardActions
          invitationId={attempt.id}
          code={attempt.code}
          inviteUrl={attempt.inviteUrl}
          identityAmbiguous={item.identityAmbiguous}
        />
      ) : (
        <InvitationActions
          invitationId={attempt.id}
          code={attempt.code}
          inviteUrl={attempt.inviteUrl}
          identityAmbiguous={item.identityAmbiguous}
        />
      )
    ) : null;

  const reissueActions =
    attempt.status === "expired" || attempt.status === "revoked" ? (
      <ReissueActions
        participantId={item.participantId}
        identityAmbiguous={item.identityAmbiguous}
        defaultWave={attempt.campaign ?? ""}
        variant={variant}
      />
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
      <div className="mt-1">
        <DeliveryStatusSummary delivery={attempt.latestDeliveryAttempt} />
      </div>
      {pendingActions}
      {reissueActions}
      {attempt.latestDeliveryAttempt && (
        <DeliveryHistoryDisclosure invitationId={attempt.id} />
      )}
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
    <div
      data-testid="participant-card"
      className="bg-surface-secondary rounded-lg border border-border p-4"
    >
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
