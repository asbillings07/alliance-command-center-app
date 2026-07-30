"use client";

import { useState, useTransition } from "react";
import type { FeedbackTriageStatus } from "@/app/generated/prisma/enums";
import { Button, Input, Label, Textarea } from "@/app/src/components/client";
import type { StaleConflictPayload } from "@/app/src/lib/feedbackTriage";
import { GITHUB_ISSUE_URL_PATTERN } from "@/app/src/lib/feedbackTriage";
import {
  recordFeedbackTriageEventAction,
  type RecordFeedbackTriageEventResult,
} from "./actions";
import {
  ALL_TRIAGE_STATUSES,
  TRIAGE_STATUS_LABELS,
  formatActorLabel,
} from "./labels";
import {
  applyConflictBaseline,
  type TriageBaseline,
} from "./staleConflict";

type FeedbackTriagePanelProps = {
  feedbackId: string;
  initialStatus: FeedbackTriageStatus;
  initialNeedsResponse: boolean;
  initialGithubIssueUrl: string | null;
  initialStateRevision: number;
};

function formatConflictTimestamp(value: Date | string | null): string {
  if (!value) return "Unknown time";
  const date = typeof value === "string" ? new Date(value) : value;
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FeedbackTriagePanel({
  feedbackId,
  initialStatus,
  initialNeedsResponse,
  initialGithubIssueUrl,
  initialStateRevision,
}: FeedbackTriagePanelProps) {
  const [baseline, setBaseline] = useState<TriageBaseline>({
    status: initialStatus,
    needsResponse: initialNeedsResponse,
    githubIssueUrl: initialGithubIssueUrl,
    stateRevision: initialStateRevision,
  });
  const [status, setStatus] = useState(initialStatus);
  const [needsResponse, setNeedsResponse] = useState(initialNeedsResponse);
  const [githubIssueUrl, setGithubIssueUrl] = useState(
    initialGithubIssueUrl ?? "",
  );
  const [note, setNote] = useState("");
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [conflict, setConflict] = useState<StaleConflictPayload | null>(null);
  const [githubHint, setGithubHint] = useState<string | null>(null);

  const handleRefreshFromConflict = () => {
    if (!conflict) return;
    const nextBaseline = applyConflictBaseline(conflict);
    setBaseline(nextBaseline);
    setConflict(null);
    setError(null);
    setSuccess(
      "Baseline refreshed to the latest state. Your edits are preserved — submit again when ready.",
    );
  };

  const handleSubmit = () => {
    setError(null);
    setSuccess(null);
    setConflict(null);

    const trimmedGithub = githubIssueUrl.trim();
    if (
      trimmedGithub.length > 0 &&
      !GITHUB_ISSUE_URL_PATTERN.test(trimmedGithub)
    ) {
      setGithubHint(
        "Use https://github.com/{owner}/{repo}/issues/{number}",
      );
      return;
    }
    setGithubHint(null);

    const changes: {
      status?: FeedbackTriageStatus;
      note?: string;
      needsResponse?: boolean;
      githubIssueUrl?: string | null;
    } = {};

    if (status !== baseline.status) {
      changes.status = status;
    }
    if (needsResponse !== baseline.needsResponse) {
      changes.needsResponse = needsResponse;
    }

    const normalizedBaselineGithub = baseline.githubIssueUrl ?? "";
    if (trimmedGithub !== normalizedBaselineGithub) {
      changes.githubIssueUrl = trimmedGithub.length > 0 ? trimmedGithub : null;
    }

    const trimmedNote = note.trim();
    if (trimmedNote.length > 0) {
      changes.note = trimmedNote;
    }

    startTransition(async () => {
      const result: RecordFeedbackTriageEventResult =
        await recordFeedbackTriageEventAction(
          feedbackId,
          baseline.stateRevision,
          changes,
        );

      if (result.success) {
        setSuccess("Triage update saved.");
        setNote("");
        return;
      }

      setError(result.error);
      if (result.conflict) {
        setConflict(result.conflict);
      }
    });
  };

  return (
    <div
      className="mt-3 p-4 bg-surface-secondary border border-border rounded-lg space-y-4"
      data-testid="feedback-triage-panel"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <Label htmlFor={`triage-status-${feedbackId}`}>Status</Label>
          <select
            id={`triage-status-${feedbackId}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as FeedbackTriageStatus)}
            disabled={isPending}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary"
          >
            {ALL_TRIAGE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {TRIAGE_STATUS_LABELS[value]}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-end">
          <label className="inline-flex items-center gap-2 text-sm text-text-primary">
            <input
              type="checkbox"
              checked={needsResponse}
              onChange={(e) => setNeedsResponse(e.target.checked)}
              disabled={isPending}
              className="rounded border-border"
            />
            Needs response
          </label>
        </div>
      </div>

      <div>
        <Label htmlFor={`triage-github-${feedbackId}`}>GitHub issue URL</Label>
        <Input
          id={`triage-github-${feedbackId}`}
          value={githubIssueUrl}
          onChange={(e) => {
            setGithubIssueUrl(e.target.value);
            setGithubHint(null);
          }}
          placeholder="https://github.com/owner/repo/issues/123"
          disabled={isPending}
        />
        {githubHint && (
          <p className="text-xs text-warning mt-1" data-testid="github-url-hint">
            {githubHint}
          </p>
        )}
      </div>

      <div>
        <Label htmlFor={`triage-note-${feedbackId}`}>Internal note</Label>
        <Textarea
          id={`triage-note-${feedbackId}`}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={3}
          placeholder="Add an internal note (optional)"
          disabled={isPending}
        />
      </div>

      <input
        type="hidden"
        name="lastSeenStateRevision"
        value={baseline.stateRevision}
      />

      {conflict && (
        <div
          role="alert"
          className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-3"
          data-testid="stale-conflict-recovery"
        >
          <p className="text-sm text-text-primary font-medium">
            This item changed while you were editing
          </p>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-text-muted">Current status</dt>
              <dd>{TRIAGE_STATUS_LABELS[conflict.status]}</dd>
            </div>
            <div>
              <dt className="text-text-muted">Needs response</dt>
              <dd>{conflict.needsResponse ? "Yes" : "No"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-text-muted">GitHub link</dt>
              <dd>{conflict.githubIssueUrl ?? "None"}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-text-muted">Last changed</dt>
              <dd>
                {formatConflictTimestamp(conflict.lastStateChangeAt)}
                {conflict.lastStateChangeActorEmail
                  ? ` by ${formatActorLabel(
                      conflict.lastStateChangeActorEmail,
                      conflict.lastStateChangeActorDisplayName,
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
            data-testid="stale-conflict-refresh"
          >
            Use current state and edit again
          </Button>
        </div>
      )}

      {error && !conflict && (
        <p className="text-sm text-danger" data-testid="triage-error">
          {error}
        </p>
      )}
      {success && (
        <p className="text-sm text-success" data-testid="triage-success">
          {success}
        </p>
      )}

      <Button
        type="button"
        onClick={handleSubmit}
        loading={isPending}
        data-testid="triage-submit"
      >
        Save triage update
      </Button>
    </div>
  );
}
