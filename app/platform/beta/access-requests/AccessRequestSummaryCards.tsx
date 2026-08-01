import Link from "next/link";
import type { AccessRequestTriageStatus } from "@/app/generated/prisma/enums";
import type { AccessRequestInboxStatusCounts } from "@/app/src/lib/platform/accessRequestInbox";
import { ACCESS_REQUEST_STATUS_LABELS, ALL_ACCESS_REQUEST_STATUSES } from "./labels";
import { buildAccessRequestHref, type AccessRequestUrlState } from "./urlParams";

type AccessRequestSummaryCardsProps = {
  statusCounts: AccessRequestInboxStatusCounts;
  urlState: AccessRequestUrlState;
};

const STATUS_TONE: Record<AccessRequestTriageStatus, "warning" | "success" | "danger" | "info"> = {
  PENDING: "warning",
  INVITED: "success",
  DECLINED: "danger",
  RESOLVED_EXISTING_ACCESS: "info",
};

const toneClasses = {
  warning: "bg-warning/10 border-warning/20",
  success: "bg-success/10 border-success/20",
  danger: "bg-danger/10 border-danger/20",
  info: "bg-primary/10 border-primary/20",
} as const;

const countClasses = {
  warning: "text-warning",
  success: "text-success",
  danger: "text-danger",
  info: "text-primary",
} as const;

/**
 * Global (not search-filtered) status counts, per accessRequestInbox.ts's
 * documented two-query shape — deliberately simpler than Feedback's
 * search-aware summary; this table is small enough that the simpler,
 * always-current-total form is preferable to a per-filter recomputation.
 */
export function AccessRequestSummaryCards({ statusCounts, urlState }: AccessRequestSummaryCardsProps) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
      {ALL_ACCESS_REQUEST_STATUSES.map((status) => {
        const active = urlState.status === status;
        const tone = STATUS_TONE[status];
        return (
          <Link
            key={status}
            href={buildAccessRequestHref(urlState, { toggleStatus: status })}
            aria-label={ACCESS_REQUEST_STATUS_LABELS[status]}
            aria-current={active ? "true" : undefined}
            className={`block rounded-lg border p-4 transition-colors hover:border-border-hover ${toneClasses[tone]} ${
              active ? "ring-2 ring-primary/40" : ""
            }`}
          >
            <div className={`text-2xl font-bold ${countClasses[tone]}`}>{statusCounts[status]}</div>
            <div className="text-sm text-text-muted">{ACCESS_REQUEST_STATUS_LABELS[status]}</div>
          </Link>
        );
      })}
    </div>
  );
}
