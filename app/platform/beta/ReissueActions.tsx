"use client";

import { useState, useTransition } from "react";
import { Input, Label } from "@/app/src/components/client";
import {
  reissueInvitationAction,
  type ReissueInvitationResult,
} from "./actions";

type ReissueActionsProps = {
  participantId: string;
  identityAmbiguous: boolean;
  defaultWave: string;
  variant: "card" | "row";
};

function ReissueBlockedMessage({ message }: { message: string }) {
  return (
    <p className="text-xs text-warning mt-2" data-testid="reissue-blocked">
      {message}
    </p>
  );
}

function ReissueSuccessNotice({
  result,
  onDismiss,
}: {
  result: Extract<ReissueInvitationResult, { success: true }>;
  onDismiss: () => void;
}) {
  return (
    <div
      className="mt-2 p-2 bg-success/10 border border-success/20 rounded text-xs space-y-1"
      data-testid="reissue-success"
    >
      <p className="text-success font-medium">Reissued successfully</p>
      <p className="text-text-muted">
        Code: <span className="font-mono">{result.inviteCode}</span>
      </p>
      {result.emailStatus !== "sent" && (
        <p className="text-warning">
          Email was not sent ({result.emailStatus}). Share credentials manually.
        </p>
      )}
      <button
        type="button"
        onClick={onDismiss}
        className="text-primary hover:text-primary-hover"
      >
        Dismiss
      </button>
    </div>
  );
}

export function ReissueActions({
  participantId,
  identityAmbiguous,
  defaultWave,
  variant,
}: ReissueActionsProps) {
  const [open, setOpen] = useState(false);
  const [wave, setWave] = useState(defaultWave);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<Extract<
    ReissueInvitationResult,
    { success: true }
  > | null>(null);

  if (identityAmbiguous) {
    return (
      <ReissueBlockedMessage message="Reissue is blocked while participant identity is ambiguous." />
    );
  }

  const handleToggle = () => {
    setOpen((prev) => !prev);
    setError(null);
    setWave(defaultWave);
  };

  const handleSubmit = () => {
    setError(null);
    startTransition(async () => {
      const result = await reissueInvitationAction(participantId, wave);
      if (result.success) {
        setSuccess(result);
        setOpen(false);
      } else {
        setError(result.error);
      }
    });
  };

  const buttonClass =
    variant === "card"
      ? "px-3 py-1 text-sm bg-surface-secondary hover:bg-surface-tertiary border border-border rounded-lg transition-colors disabled:opacity-50"
      : "text-xs text-primary hover:text-primary-hover disabled:opacity-50";

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={handleToggle}
        disabled={isPending}
        className={buttonClass}
        data-testid="reissue-toggle"
      >
        {open ? "Cancel reissue" : isPending ? "Reissuing..." : "Reissue"}
      </button>

      {open && (
        <div
          className="mt-2 p-3 bg-surface-secondary border border-border rounded-lg space-y-3"
          data-testid="reissue-form"
        >
          <div>
            <Label htmlFor={`reissue-wave-${participantId}`}>
              Beta wave{" "}
              <span className="text-text-muted font-normal">(inherited from prior attempt)</span>
            </Label>
            <Input
              id={`reissue-wave-${participantId}`}
              name="wave"
              type="text"
              value={wave}
              onChange={(e) => setWave(e.target.value)}
              disabled={isPending}
              placeholder="Leave blank for no wave"
            />
          </div>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={isPending}
            className={
              variant === "card"
                ? "px-3 py-1 text-sm bg-primary text-white rounded-lg disabled:opacity-50"
                : "text-xs text-primary hover:text-primary-hover disabled:opacity-50"
            }
            data-testid="reissue-submit"
          >
            {isPending ? "Reissuing..." : "Confirm reissue"}
          </button>
          {error && (
            <p className="text-xs text-danger" data-testid="reissue-error">
              {error}
            </p>
          )}
        </div>
      )}

      {success && (
        <ReissueSuccessNotice result={success} onDismiss={() => setSuccess(null)} />
      )}
    </div>
  );
}
