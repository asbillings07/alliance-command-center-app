"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/src/components/client";
import { fetchAccessRequestHistoryAction } from "./actions";
import { formatActorLabel, formatHistoryEventDetails, formatHistoryEventSummary } from "./labels";
import type { AccessRequestTriageHistoryItem } from "@/app/src/lib/platform/accessRequestInbox";

const COMPACT_PAGE_SIZE = 5;
const FULL_PAGE_SIZE = 10;

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function HistoryEventRow({ event }: { event: AccessRequestTriageHistoryItem }) {
  const details = formatHistoryEventDetails(event);
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-sm">
      <div className="text-text-primary font-medium">{formatHistoryEventSummary(event)}</div>
      <div className="text-text-secondary">
        {formatActorLabel(event.actorEmail, event.actorDisplayName)}
      </div>
      <div className="text-xs text-text-muted">{formatDateTime(event.createdAt)}</div>
      {details.length > 0 && (
        <ul className="mt-2 space-y-1 text-text-secondary">
          {details.map((line, index) => (
            <li key={index}>{line}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/**
 * Per-request decision history (#177 design decision 1): three tiers reached
 * without ever discarding data —
 *   1. The queue row already shows the last decision's operator/timestamp
 *      (denormalized on AccessRequestTriage, rendered by the caller).
 *   2. "Show history" here loads the 5 newest events.
 *   3. "View full history" switches the same view to real pagination, so
 *      every event remains reachable.
 */
export function AccessRequestHistory({ accessRequestId }: { accessRequestId: string }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"compact" | "full">("compact");
  const [isPending, startTransition] = useTransition();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<AccessRequestTriageHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const pageSize = mode === "compact" ? COMPACT_PAGE_SIZE : FULL_PAGE_SIZE;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const loadPage = (targetPage: number, targetPageSize: number) => {
    setError(null);
    startTransition(async () => {
      const result = await fetchAccessRequestHistoryAction(
        accessRequestId,
        targetPage,
        targetPageSize,
      );
      if (!result.success) {
        setError(result.error);
        return;
      }
      setItems(result.items);
      setTotal(result.total);
      setPage(result.page);
      setLoaded(true);
    });
  };

  const handleToggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (nextOpen && !loaded) {
      loadPage(1, COMPACT_PAGE_SIZE);
    }
  };

  const handleViewFullHistory = () => {
    setMode("full");
    loadPage(1, FULL_PAGE_SIZE);
  };

  return (
    <div className="mt-3" data-testid="access-request-history">
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={handleToggle}
        aria-expanded={open}
        data-testid="access-request-history-toggle"
      >
        {open ? "Hide history" : "Show history"}
      </Button>

      {open && (
        <div className="mt-2 space-y-3">
          {error && (
            <p className="text-sm text-danger" data-testid="access-request-history-error">
              {error}
            </p>
          )}

          {loaded && items.length === 0 && !error && (
            <p className="text-sm text-text-muted">No history events yet.</p>
          )}

          {items.map((event) => (
            <HistoryEventRow key={event.id} event={event} />
          ))}

          {mode === "compact" && loaded && total > COMPACT_PAGE_SIZE && (
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={handleViewFullHistory}
              data-testid="access-request-history-view-full"
            >
              View full history ({total})
            </Button>
          )}

          {mode === "full" && total > FULL_PAGE_SIZE && (
            <div className="flex items-center justify-between gap-3 text-sm text-text-muted">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isPending || page <= 1}
                  onClick={() => loadPage(page - 1, FULL_PAGE_SIZE)}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isPending || page >= totalPages}
                  onClick={() => loadPage(page + 1, FULL_PAGE_SIZE)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
