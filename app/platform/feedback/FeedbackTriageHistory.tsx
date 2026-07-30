"use client";

import { useState, useTransition } from "react";
import { Button } from "@/app/src/components/client";
import { fetchFeedbackTriageHistoryAction } from "./actions";
import {
  formatActorLabel,
  formatHistoryEventChanges,
} from "./labels";
import type { FeedbackTriageHistoryItem } from "@/app/src/lib/platform/feedbackInbox";

const HISTORY_PAGE_SIZE = 10;

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function FeedbackTriageHistory({ feedbackId }: { feedbackId: string }) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState<FeedbackTriageHistoryItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const totalPages = Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));

  const loadPage = (targetPage: number) => {
    setError(null);
    startTransition(async () => {
      const result = await fetchFeedbackTriageHistoryAction(
        feedbackId,
        targetPage,
        HISTORY_PAGE_SIZE,
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
      loadPage(1);
    }
  };

  return (
    <div className="mt-3" data-testid="feedback-triage-history">
      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={handleToggle}
        aria-expanded={open}
      >
        {open ? "Hide triage history" : "Show triage history"}
        {loaded ? ` (${total})` : ""}
      </Button>

      {open && (
        <div className="mt-2 space-y-3">
          {error && (
            <p className="text-sm text-danger" data-testid="history-error">
              {error}
            </p>
          )}

          {loaded && items.length === 0 && !error && (
            <p className="text-sm text-text-muted">No triage events yet.</p>
          )}

          {items.map((event) => {
            const changes = formatHistoryEventChanges(event);
            return (
              <div
                key={event.id}
                className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
              >
                <div className="text-text-primary">
                  {formatActorLabel(event.actorEmail, event.actorDisplayName)}
                </div>
                <div className="text-xs text-text-muted">
                  {formatDateTime(event.createdAt)}
                </div>
                <ul className="mt-2 space-y-1 text-text-secondary">
                  {changes.map((change) => (
                    <li key={change}>{change}</li>
                  ))}
                </ul>
              </div>
            );
          })}

          {total > HISTORY_PAGE_SIZE && (
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
                  onClick={() => loadPage(page - 1)}
                >
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={isPending || page >= totalPages}
                  onClick={() => loadPage(page + 1)}
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
