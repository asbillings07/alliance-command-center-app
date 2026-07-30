import Link from "next/link";
import type { FeedbackTriageStatus } from "@/app/generated/prisma/enums";
import type { FeedbackInboxSummary } from "@/app/src/lib/platform/feedbackInbox";
import { ALL_TRIAGE_STATUSES, TRIAGE_STATUS_LABELS } from "./labels";
import { buildFeedbackHref, type FeedbackUrlState } from "./urlParams";

type FeedbackSummaryCardsProps = {
  summary: FeedbackInboxSummary;
  urlState: FeedbackUrlState;
};

function SummaryCardLink({
  href,
  active,
  count,
  label,
  tone = "default",
}: {
  href: string;
  active: boolean;
  count: number;
  label: string;
  tone?: "default" | "warning" | "info" | "success" | "neutral";
}) {
  const toneClasses = {
    default: "bg-surface-secondary border-border",
    warning: "bg-warning/10 border-warning/20",
    info: "bg-primary/10 border-primary/20",
    success: "bg-success/10 border-success/20",
    neutral: "bg-surface-secondary border-border",
  } as const;

  const countClasses = {
    default: "text-text-primary",
    warning: "text-warning",
    info: "text-primary",
    success: "text-success",
    neutral: "text-text-primary",
  } as const;

  return (
    <Link
      href={href}
      aria-current={active ? "true" : undefined}
      className={`block rounded-lg border p-4 transition-colors hover:border-border-hover ${toneClasses[tone]} ${
        active ? "ring-2 ring-primary/40" : ""
      }`}
    >
      <div className={`text-2xl font-bold ${countClasses[tone]}`}>{count}</div>
      <div className="text-sm text-text-muted">{label}</div>
    </Link>
  );
}

export function FeedbackSummaryCards({
  summary,
  urlState,
}: FeedbackSummaryCardsProps) {
  const totalActive =
    !urlState.status && urlState.needsResponse === undefined;

  const needsResponseActive = urlState.needsResponse === "true";

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-7 gap-4 mb-6">
      <SummaryCardLink
        href={buildFeedbackHref(urlState, { clearStatus: true })}
        active={totalActive}
        count={summary.totalMatchingOtherFacets}
        label="Total"
      />
      <SummaryCardLink
        href={buildFeedbackHref(urlState, { toggleNeedsResponse: true })}
        active={needsResponseActive}
        count={summary.needsResponseCount}
        label="Needs response"
        tone="warning"
      />
      {ALL_TRIAGE_STATUSES.map((status) => (
        <StatusSummaryCard
          key={status}
          status={status}
          count={summary.statusCounts[status]}
          urlState={urlState}
        />
      ))}
    </div>
  );
}

function StatusSummaryCard({
  status,
  count,
  urlState,
}: {
  status: FeedbackTriageStatus;
  count: number;
  urlState: FeedbackUrlState;
}) {
  const active = urlState.status === status;

  return (
    <SummaryCardLink
      href={buildFeedbackHref(urlState, { toggleStatus: status })}
      active={active}
      count={count}
      label={TRIAGE_STATUS_LABELS[status]}
      tone={status === "NEW" ? "info" : status === "RESOLVED" ? "success" : "neutral"}
    />
  );
}
