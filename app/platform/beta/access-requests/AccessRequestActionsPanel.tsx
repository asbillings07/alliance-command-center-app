"use client";

import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { Button, Label, Textarea } from "@/app/src/components/client";
import type { InvitationConflictType } from "@/app/generated/prisma/enums";
import type {
  InvitationConflictDetail,
  InvitationConflictResolution,
} from "@/app/src/lib/invitationConflict";
import type {
  AccessRequestInboxListItem,
  BetaWaveOption,
} from "@/app/src/lib/platform/accessRequestInbox";
import {
  addAccessRequestNoteAction,
  checkAccessRequestConflictAction,
  convertAccessRequestAction,
  declineAccessRequestAction,
  reopenAccessRequestAction,
  resolveExistingAccessAction,
  type AccessRequestActionResult,
  type ConvertAccessRequestActionResult,
  type DeliveryDisposition,
} from "./actions";
import { AccessRequestHistory } from "./AccessRequestHistory";
import {
  BetaWaveSelect,
  NONE_WAVE_CHOICE,
  getWaveSubmitValue,
  isWaveChoiceValid,
  type WaveChoice,
} from "./BetaWaveSelect";
import { ACCESS_REQUEST_STATUS_LABELS, CONFLICT_TYPE_GUIDANCE, CONFLICT_TYPE_LABELS, formatActorLabel } from "./labels";
import {
  applyConflictBaseline,
  formatConflictTimestamp,
  type AccessRequestBaseline,
  type AccessRequestConflictPayload,
} from "./staleConflict";

type ConflictRecoveryKind = "stale" | "reopen_denied" | "conversion_blocked";

type ConflictRecovery = {
  kind: ConflictRecoveryKind;
  message: string;
  payload: AccessRequestConflictPayload;
  conflictType?: InvitationConflictType;
};

function conflictRecoveryTitle(kind: ConflictRecoveryKind): string {
  switch (kind) {
    case "stale":
      return "This request changed while you were working on it";
    case "reopen_denied":
      return "Reopen denied — access still exists";
    case "conversion_blocked":
      return "Approval blocked";
  }
}

type ConflictCheckResultState =
  | { key: string; status: "loaded"; resolution: InvitationConflictResolution }
  | { key: string; status: "error"; message: string };

function DeliveryDispositionNotice({
  disposition,
  email,
}: {
  disposition: DeliveryDisposition;
  email: string;
}) {
  if (disposition.type === "ATTEMPTED") {
    if (disposition.status === "sent") {
      return <p className="text-sm text-success">Invitation email sent to {email}.</p>;
    }
    if (disposition.status === "skipped") {
      return (
        <p className="text-sm text-text-muted">
          Email delivery is not configured, so no email was sent. Share the link or code manually.
        </p>
      );
    }
    return (
      <p className="text-sm text-warning">
        The invitation is valid, but we couldn&apos;t send the email. Share the link or code manually,
        or use Resend on the Beta page.
      </p>
    );
  }
  if (disposition.type === "NOT_RETRIED_IDEMPOTENT") {
    return (
      <p className="text-sm text-text-muted">
        This request was already approved — no new email was sent this time. Delivery status is not
        recorded here; check the Beta page.
      </p>
    );
  }
  if (disposition.type === "NOT_ATTEMPTED") {
    return (
      <p className="text-sm text-warning">
        Invitation created, but the email couldn&apos;t be sent because your account couldn&apos;t be
        verified. Share the link or code manually.
      </p>
    );
  }
  return <p className="text-sm text-warning">{disposition.message}</p>;
}

function ApproveSuccessCard({
  result,
  email,
  onDismiss,
}: {
  result: Extract<ConvertAccessRequestActionResult, { success: true }>;
  email: string;
  onDismiss: () => void;
}) {
  return (
    <div
      className="rounded-lg border border-success/20 bg-success/5 p-4 space-y-3"
      data-testid="access-request-convert-success"
    >
      <p className="text-sm font-semibold text-success">Invitation created</p>
      <DeliveryDispositionNotice disposition={result.disposition} email={email} />
      <div className="text-sm">
        <div className="text-text-muted">Invite code</div>
        <div className="font-mono font-bold text-text-primary">{result.inviteCode}</div>
      </div>
      <div className="text-sm">
        <div className="text-text-muted">Invite link</div>
        <code className="text-xs text-text-secondary break-all">{result.inviteUrl}</code>
      </div>
      <Button type="button" variant="secondary" size="sm" onClick={onDismiss}>
        Close
      </Button>
    </div>
  );
}

/** EXISTING_ALLIANCE_ACCESS is the only conflict type resolveExistingAccessAction re-verifies (accessRequestTriage.ts) — the "Resolve" action only ever appears here. */
function ExistingAccessPanel({
  detail,
  accessRequestId,
  disabled,
  resolveOpen,
  resolveReason,
  onResolveOpen,
  onResolveReasonChange,
  onResolveSubmit,
  onResolveCancel,
  isPending,
}: {
  detail: Extract<InvitationConflictDetail, { type: "EXISTING_ALLIANCE_ACCESS" }>;
  accessRequestId: string;
  disabled?: boolean;
  resolveOpen: boolean;
  resolveReason: string;
  onResolveOpen: () => void;
  onResolveReasonChange: (value: string) => void;
  onResolveSubmit: () => void;
  onResolveCancel: () => void;
  isPending: boolean;
}) {
  const reasonId = `access-request-resolve-reason-${accessRequestId}`;
  return (
    <div
      className="rounded-lg border border-primary/30 bg-primary/10 p-3 space-y-3"
      data-testid="access-request-existing-access"
    >
      <p className="text-sm text-text-primary font-medium">Already has alliance access</p>
      <dl className="text-sm space-y-1">
        <div>
          <dt className="inline text-text-muted">User:</dt>{" "}
          <dd className="inline">{formatActorLabel(detail.userEmail, detail.userDisplayName)}</dd>
        </div>
        <div>
          <dt className="inline text-text-muted">Alliance:</dt>{" "}
          <dd className="inline">
            <Link
              href={`/platform/support/alliance/${detail.allianceId}`}
              className="text-primary hover:text-primary-hover"
            >
              {detail.allianceName}
            </Link>
          </dd>
        </div>
        <div>
          <dt className="inline text-text-muted">Memberships:</dt>{" "}
          <dd className="inline">{detail.membershipCount}</dd>
        </div>
      </dl>

      <p className="text-xs text-text-muted">
        No action is required to keep this request pending while you investigate.
      </p>

      {!resolveOpen ? (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={onResolveOpen}
          disabled={disabled}
          data-testid="access-request-resolve-open"
        >
          Resolve — already has access
        </Button>
      ) : (
        <div className="space-y-2">
          <Label htmlFor={reasonId} required>
            Resolution reason
          </Label>
          <Textarea
            id={reasonId}
            value={resolveReason}
            onChange={(e) => onResolveReasonChange(e.target.value)}
            rows={2}
            disabled={disabled}
            data-testid="access-request-resolve-reason"
          />
          <div className="flex gap-2">
            <Button
              type="button"
              size="sm"
              onClick={onResolveSubmit}
              loading={isPending}
              disabled={disabled || resolveReason.trim().length === 0}
              data-testid="access-request-resolve-submit"
            >
              Confirm resolve
            </Button>
            <Button type="button" size="sm" variant="secondary" onClick={onResolveCancel} disabled={disabled}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function OtherConflictNotice({
  detail,
  email,
}: {
  detail: Exclude<InvitationConflictDetail, { type: "EXISTING_ALLIANCE_ACCESS" }>;
  email: string;
}) {
  return (
    <div
      className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-2"
      data-testid="access-request-conflict-notice"
    >
      <p className="text-sm text-text-primary font-medium">{CONFLICT_TYPE_LABELS[detail.type]}</p>
      <p className="text-sm text-text-secondary">{CONFLICT_TYPE_GUIDANCE[detail.type]}</p>
      <p className="text-sm">
        <Link
          href={`/platform/beta?search=${encodeURIComponent(email)}`}
          className="text-primary hover:text-primary-hover"
        >
          Open on the Beta page
        </Link>
      </p>
    </div>
  );
}

type AccessRequestActionsPanelProps = {
  item: AccessRequestInboxListItem;
  waveOptions: BetaWaveOption[] | null;
  onRequestWaveOptions: () => void;
};

/**
 * Per-request triage actions (#177): note / decline / resolve-existing-access
 * / reopen / approve-and-invite, gated by a fresh on-demand conflict
 * pre-check whenever the request is PENDING (design decisions 1–3).
 *
 * Mirrors FeedbackTriagePanel's baseline + stale-conflict-recovery shape,
 * generalized to the three commit-bearing non-success outcomes this domain
 * can return (STALE_CONFLICT, REOPEN_DENIED_ACCESS_STILL_EXISTS,
 * CONVERSION_BLOCKED) — all three already advanced stateRevision server-side
 * (#177 review), so all three are handled by the same "refresh baseline"
 * recovery affordance rather than three bespoke UIs.
 */
export function AccessRequestActionsPanel({
  item,
  waveOptions,
  onRequestWaveOptions,
}: AccessRequestActionsPanelProps) {
  const [baseline, setBaseline] = useState<AccessRequestBaseline>({
    status: item.status,
    betaWave: item.betaWave,
    currentReason: item.currentReason,
    stateRevision: item.stateRevision,
  });
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflictRecovery, setConflictRecovery] = useState<ConflictRecovery | null>(null);

  const [note, setNote] = useState("");

  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");

  const [resolveOpen, setResolveOpen] = useState(false);
  const [resolveReason, setResolveReason] = useState("");

  const [reopenOpen, setReopenOpen] = useState(false);
  const [reopenReason, setReopenReason] = useState("");

  const [waveChoice, setWaveChoice] = useState<WaveChoice>(NONE_WAVE_CHOICE);
  const [convertSuccess, setConvertSuccess] = useState<Extract<
    ConvertAccessRequestActionResult,
    { success: true }
  > | null>(null);

  const [conflictCheckNonce, setConflictCheckNonce] = useState(0);
  // Keyed rather than reset-then-fetched: the effect below never calls
  // setState synchronously (only from the async callback), so "is this
  // result still current" is derived by comparing keys at render time
  // instead of an eagerly-set "loading" state (react-hooks/set-state-in-effect).
  const conflictCheckKey = `${baseline.status}:${baseline.stateRevision}:${conflictCheckNonce}`;
  const [conflictCheckResult, setConflictCheckResult] = useState<ConflictCheckResultState | null>(null);
  const isConflictCheckLoading =
    baseline.status === "PENDING" && conflictCheckResult?.key !== conflictCheckKey;

  useEffect(() => {
    if (baseline.status !== "PENDING") return;
    let cancelled = false;
    const key = conflictCheckKey;
    checkAccessRequestConflictAction(item.accessRequestId).then((result) => {
      if (cancelled) return;
      if (!result.success) {
        setConflictCheckResult({ key, status: "error", message: result.error });
        return;
      }
      setConflictCheckResult({ key, status: "loaded", resolution: result.resolution });
    });
    return () => {
      cancelled = true;
    };
  }, [baseline.status, conflictCheckKey, item.accessRequestId]);

  const applyFailure = (result: Extract<AccessRequestActionResult, { success: false }>) => {
    setError(result.error);
    if (result.code === "STALE_CONFLICT") {
      setConflictRecovery({ kind: "stale", message: result.error, payload: result.conflict });
    } else if (result.code === "REOPEN_DENIED_ACCESS_STILL_EXISTS") {
      setConflictRecovery({ kind: "reopen_denied", message: result.error, payload: result.conflict });
    }
  };

  const applyConvertFailure = (result: Extract<ConvertAccessRequestActionResult, { success: false }>) => {
    setError(result.error);
    if (result.code === "STALE_CONFLICT") {
      setConflictRecovery({ kind: "stale", message: result.error, payload: result.conflict });
    } else if (result.code === "CONVERSION_BLOCKED") {
      setConflictRecovery({
        kind: "conversion_blocked",
        message: result.error,
        payload: result.conflict,
        conflictType: result.conflictType,
      });
    }
  };

  const handleRefreshFromConflict = () => {
    if (!conflictRecovery) return;
    setBaseline(applyConflictBaseline(conflictRecovery.payload));
    setConflictRecovery(null);
    setError(null);
    setSuccess("Baseline refreshed to the latest state.");
  };

  const handleAddNote = () => {
    setError(null);
    setSuccess(null);
    setConflictRecovery(null);
    const trimmed = note.trim();
    if (!trimmed) {
      setError("Note is required");
      return;
    }
    startTransition(async () => {
      const result = await addAccessRequestNoteAction(item.accessRequestId, trimmed);
      if (result.success) {
        setBaseline(applyConflictBaseline(result.projection));
        setSuccess("Note added.");
        setNote("");
        return;
      }
      applyFailure(result);
    });
  };

  const handleDecline = () => {
    setError(null);
    setSuccess(null);
    setConflictRecovery(null);
    const trimmed = declineReason.trim();
    if (!trimmed) {
      setError("Decline reason is required");
      return;
    }
    startTransition(async () => {
      const result = await declineAccessRequestAction(item.accessRequestId, trimmed, baseline.stateRevision);
      if (result.success) {
        setBaseline(applyConflictBaseline(result.projection));
        setSuccess("Request declined.");
        setDeclineOpen(false);
        setDeclineReason("");
        return;
      }
      applyFailure(result);
    });
  };

  const handleResolve = () => {
    setError(null);
    setSuccess(null);
    setConflictRecovery(null);
    const trimmed = resolveReason.trim();
    if (!trimmed) {
      setError("Resolution reason is required");
      return;
    }
    startTransition(async () => {
      const result = await resolveExistingAccessAction(item.accessRequestId, trimmed, baseline.stateRevision);
      if (result.success) {
        setBaseline(applyConflictBaseline(result.projection));
        setSuccess("Request resolved — already has access.");
        setResolveOpen(false);
        setResolveReason("");
        return;
      }
      applyFailure(result);
    });
  };

  const handleReopen = () => {
    setError(null);
    setSuccess(null);
    setConflictRecovery(null);
    const trimmed = reopenReason.trim();
    if (!trimmed) {
      setError("Reopen reason is required");
      return;
    }
    startTransition(async () => {
      const result = await reopenAccessRequestAction(item.accessRequestId, trimmed, baseline.stateRevision);
      if (result.success) {
        setBaseline(applyConflictBaseline(result.projection));
        setSuccess("Request reopened.");
        setReopenOpen(false);
        setReopenReason("");
        return;
      }
      applyFailure(result);
    });
  };

  const handleApprove = () => {
    setError(null);
    setSuccess(null);
    setConflictRecovery(null);
    const waveValue = getWaveSubmitValue(waveChoice);
    if (!waveValue) return;
    startTransition(async () => {
      const result = await convertAccessRequestAction(item.accessRequestId, waveValue, baseline.stateRevision);
      if (result.success) {
        setBaseline(applyConflictBaseline(result.projection));
        setConvertSuccess(result);
        setWaveChoice(NONE_WAVE_CHOICE);
        return;
      }
      applyConvertFailure(result);
    });
  };

  const renderApprovalSection = () => {
    if (isConflictCheckLoading || !conflictCheckResult) {
      return (
        <p className="text-sm text-text-muted" data-testid="access-request-conflict-loading">
          Checking for conflicts…
        </p>
      );
    }
    if (conflictCheckResult.status === "error") {
      return (
        <div className="text-sm text-danger space-y-2" data-testid="access-request-conflict-check-error">
          <p>Couldn&apos;t check for conflicts: {conflictCheckResult.message}</p>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setConflictCheckNonce((n) => n + 1)}
          >
            Retry
          </Button>
        </div>
      );
    }

    const { primary } = conflictCheckResult.resolution;

    if (primary.type === "NONE") {
      return (
        <div className="space-y-3" data-testid="access-request-approve-section">
          <BetaWaveSelect
            idPrefix={item.accessRequestId}
            waveOptions={waveOptions}
            onRequestOptions={onRequestWaveOptions}
            value={waveChoice}
            onChange={setWaveChoice}
            disabled={isPending}
          />
          <Button
            type="button"
            onClick={handleApprove}
            loading={isPending}
            disabled={isPending || !isWaveChoiceValid(waveChoice)}
            data-testid="access-request-approve-submit"
          >
            Approve and invite
          </Button>
        </div>
      );
    }

    if (primary.type === "EXISTING_ALLIANCE_ACCESS") {
      return (
        <ExistingAccessPanel
          detail={primary}
          accessRequestId={item.accessRequestId}
          disabled={isPending}
          isPending={isPending}
          resolveOpen={resolveOpen}
          resolveReason={resolveReason}
          onResolveOpen={() => setResolveOpen(true)}
          onResolveReasonChange={setResolveReason}
          onResolveSubmit={handleResolve}
          onResolveCancel={() => {
            setResolveOpen(false);
            setResolveReason("");
          }}
        />
      );
    }

    return <OtherConflictNotice detail={primary} email={item.email} />;
  };

  return (
    <div
      className="mt-3 p-4 bg-surface-secondary border border-border rounded-lg space-y-4"
      data-testid="access-request-actions-panel"
    >
      {conflictRecovery && (
        <div
          role="alert"
          className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-3"
          data-testid="access-request-conflict-recovery"
        >
          <p className="text-sm text-text-primary font-medium">
            {conflictRecoveryTitle(conflictRecovery.kind)}
          </p>
          <p className="text-sm text-text-secondary">{conflictRecovery.message}</p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-text-muted">Current status</dt>
              <dd>{ACCESS_REQUEST_STATUS_LABELS[conflictRecovery.payload.status]}</dd>
            </div>
            {conflictRecovery.payload.conflictAllianceName && (
              <div>
                <dt className="text-text-muted">Alliance</dt>
                <dd>{conflictRecovery.payload.conflictAllianceName}</dd>
              </div>
            )}
            <div className="sm:col-span-2">
              <dt className="text-text-muted">Last changed</dt>
              <dd>
                {formatConflictTimestamp(conflictRecovery.payload.lastStateChangeAt)}
                {conflictRecovery.payload.lastStateChangeActorEmail
                  ? ` by ${formatActorLabel(
                      conflictRecovery.payload.lastStateChangeActorEmail,
                      conflictRecovery.payload.lastStateChangeActorDisplayName,
                    )}`
                  : ""}
              </dd>
            </div>
          </dl>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={handleRefreshFromConflict}
            data-testid="access-request-conflict-refresh"
          >
            Use current state
          </Button>
        </div>
      )}

      {!conflictRecovery && error && (
        <p className="text-sm text-danger" data-testid="access-request-error">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-success" data-testid="access-request-success">
          {success}
        </p>
      )}

      {convertSuccess && (
        <ApproveSuccessCard
          result={convertSuccess}
          email={item.email}
          onDismiss={() => setConvertSuccess(null)}
        />
      )}

      {baseline.status === "PENDING" && !convertSuccess && renderApprovalSection()}

      {baseline.status === "PENDING" && (
        <div data-testid="access-request-decline-section">
          {!declineOpen ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setDeclineOpen(true)}
              disabled={isPending}
              data-testid="access-request-decline-open"
            >
              Decline
            </Button>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`access-request-decline-reason-${item.accessRequestId}`} required>
                Decline reason
              </Label>
              <Textarea
                id={`access-request-decline-reason-${item.accessRequestId}`}
                value={declineReason}
                onChange={(e) => setDeclineReason(e.target.value)}
                rows={2}
                disabled={isPending}
                data-testid="access-request-decline-reason"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="danger"
                  onClick={handleDecline}
                  loading={isPending}
                  disabled={isPending || declineReason.trim().length === 0}
                  data-testid="access-request-decline-submit"
                >
                  Confirm decline
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setDeclineOpen(false);
                    setDeclineReason("");
                  }}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {(baseline.status === "DECLINED" || baseline.status === "RESOLVED_EXISTING_ACCESS") && (
        <div data-testid="access-request-reopen-section">
          {baseline.currentReason && (
            <p className="text-sm text-text-secondary mb-2">
              <span className="text-text-muted">Reason:</span> {baseline.currentReason}
            </p>
          )}
          {!reopenOpen ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => setReopenOpen(true)}
              disabled={isPending}
              data-testid="access-request-reopen-open"
            >
              Reopen
            </Button>
          ) : (
            <div className="space-y-2">
              <Label htmlFor={`access-request-reopen-reason-${item.accessRequestId}`} required>
                Reopen reason
              </Label>
              <Textarea
                id={`access-request-reopen-reason-${item.accessRequestId}`}
                value={reopenReason}
                onChange={(e) => setReopenReason(e.target.value)}
                rows={2}
                disabled={isPending}
                data-testid="access-request-reopen-reason"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  onClick={handleReopen}
                  loading={isPending}
                  disabled={isPending || reopenReason.trim().length === 0}
                  data-testid="access-request-reopen-submit"
                >
                  Confirm reopen
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setReopenOpen(false);
                    setReopenReason("");
                  }}
                  disabled={isPending}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {baseline.status === "INVITED" && !convertSuccess && (
        <p className="text-sm text-text-muted" data-testid="access-request-invited-note">
          Invited{baseline.betaWave ? ` (wave: ${baseline.betaWave})` : ""}. This decision is final — use
          Resend or Reissue on the{" "}
          <Link
            href={`/platform/beta?search=${encodeURIComponent(item.email)}`}
            className="text-primary hover:text-primary-hover"
          >
            Beta page
          </Link>
          .
        </p>
      )}

      <div className="space-y-2">
        <Label htmlFor={`access-request-note-${item.accessRequestId}`}>Internal note</Label>
        <Textarea
          id={`access-request-note-${item.accessRequestId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          placeholder="Add an internal note (visible to all operators)"
          disabled={isPending}
          data-testid="access-request-note-input"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          onClick={handleAddNote}
          loading={isPending}
          disabled={isPending || note.trim().length === 0}
          data-testid="access-request-note-submit"
        >
          Add note
        </Button>
      </div>

      <AccessRequestHistory accessRequestId={item.accessRequestId} />
    </div>
  );
}
