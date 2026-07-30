"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import type { FeedbackInboxListItem } from "@/app/src/lib/platform/feedbackInbox";
import { FeedbackTriageHistory } from "./FeedbackTriageHistory";
import { FeedbackTriagePanel } from "./FeedbackTriagePanel";
import {
  FEEDBACK_CATEGORY_LABELS,
  RESPONSE_INDICATOR_LABELS,
  RESPONSE_INDICATOR_VARIANTS,
  TRIAGE_STATUS_LABELS,
  TRIAGE_STATUS_VARIANTS,
  getResponseIndicatorState,
} from "./labels";

const MESSAGE_PREVIEW_LENGTH = 180;

function formatSubmitter(item: FeedbackInboxListItem): string {
  if (item.submitterDisplayName) {
    return `${item.submitterDisplayName} (${item.submitterEmail})`;
  }
  return item.submitterEmail;
}

function FeedbackMessage({ message }: { message: string }) {
  const [expanded, setExpanded] = useState(false);
  const needsTruncation = message.length > MESSAGE_PREVIEW_LENGTH;
  const displayText =
    expanded || !needsTruncation
      ? message
      : `${message.slice(0, MESSAGE_PREVIEW_LENGTH)}…`;

  return (
    <div className="space-y-1">
      <p className="text-sm text-text-primary whitespace-pre-wrap break-words">
        {displayText}
      </p>
      {needsTruncation && (
        <Button
          type="button"
          variant="link"
          size="sm"
          onClick={() => setExpanded((prev) => !prev)}
        >
          {expanded ? "Show less" : "Show more"}
        </Button>
      )}
    </div>
  );
}

function FeedbackRowBody({ item }: { item: FeedbackInboxListItem }) {
  const [triageOpen, setTriageOpen] = useState(false);
  const responseState = getResponseIndicatorState({
    hasBeenTriaged: item.hasBeenTriaged,
    needsResponse: item.needsResponse,
  });

  return (
    <>
      <div className="flex flex-wrap items-start gap-2">
        <Badge variant="neutral" size="sm">
          {FEEDBACK_CATEGORY_LABELS[item.category]}
        </Badge>
        <Badge variant={TRIAGE_STATUS_VARIANTS[item.status]} size="sm">
          {TRIAGE_STATUS_LABELS[item.status]}
        </Badge>
        <Badge variant={RESPONSE_INDICATOR_VARIANTS[responseState]} size="sm">
          {RESPONSE_INDICATOR_LABELS[responseState]}
        </Badge>
      </div>

      <FeedbackMessage message={item.message} />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-text-muted">
        <div>
          <span className="text-text-secondary">Submitter:</span>{" "}
          {formatSubmitter(item)}
        </div>
        <div>
          <span className="text-text-secondary">Alliance:</span>{" "}
          {item.allianceId && item.allianceName ? (
            <Link
              href={`/platform/support/alliance/${item.allianceId}`}
              className="text-primary hover:text-primary-hover"
            >
              {item.allianceName}
            </Link>
          ) : (
            "No alliance"
          )}
        </div>
        <div>
          <span className="text-text-secondary">Wave:</span>{" "}
          {item.wave ?? "—"}
        </div>
        <div>
          <span className="text-text-secondary">Submitted:</span>{" "}
          {new Date(item.createdAt).toLocaleString("en-US", {
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          })}
        </div>
      </div>

      {item.githubIssueUrl && (
        <div className="text-sm">
          <a
            href={item.githubIssueUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary hover:text-primary-hover break-all"
          >
            {item.githubIssueUrl}
          </a>
        </div>
      )}

      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => setTriageOpen((prev) => !prev)}
        aria-expanded={triageOpen}
        data-testid={`triage-toggle-${item.feedbackId}`}
      >
        {triageOpen ? "Hide triage" : "Triage"}
      </Button>

      {triageOpen && (
        <>
          <FeedbackTriagePanel
            key={item.feedbackId}
            feedbackId={item.feedbackId}
            initialStatus={item.status}
            initialNeedsResponse={item.needsResponse}
            initialGithubIssueUrl={item.githubIssueUrl}
            initialStateRevision={item.stateRevision}
          />
          <FeedbackTriageHistory feedbackId={item.feedbackId} />
        </>
      )}
    </>
  );
}

export function FeedbackCard({ item }: { item: FeedbackInboxListItem }) {
  return (
    <article
      className="rounded-lg border border-border bg-surface p-4 space-y-3"
      data-testid={`feedback-card-${item.feedbackId}`}
    >
      <FeedbackRowBody item={item} />
    </article>
  );
}

export function FeedbackTableRow({ item }: { item: FeedbackInboxListItem }) {
  return (
    <tr
      className="border-b border-border align-top"
      data-testid={`feedback-row-${item.feedbackId}`}
    >
      <td className="py-4 px-4 space-y-3">
        <FeedbackRowBody item={item} />
      </td>
    </tr>
  );
}
