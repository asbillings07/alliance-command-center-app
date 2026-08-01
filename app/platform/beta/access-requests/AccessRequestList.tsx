"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";
import type { AccessRequestInboxListItem } from "@/app/src/lib/platform/accessRequestInbox";
import { fetchBetaWaveOptionsAction } from "./actions";
import { AccessRequestActionsPanel, type WaveOptionsState } from "./AccessRequestActionsPanel";
import { ACCESS_REQUEST_STATUS_LABELS, ACCESS_REQUEST_STATUS_VARIANTS, formatActorLabel } from "./labels";

function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function AccessRequestRowBody({
  item,
  waveOptionsState,
  onRequestWaveOptions,
}: {
  item: AccessRequestInboxListItem;
  waveOptionsState: WaveOptionsState;
  onRequestWaveOptions: () => void;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-start gap-2">
        <Badge variant={ACCESS_REQUEST_STATUS_VARIANTS[item.status]} size="sm">
          {ACCESS_REQUEST_STATUS_LABELS[item.status]}
        </Badge>
      </div>

      <div>
        <div className="text-sm font-medium text-text-primary">{item.name}</div>
        <div className="text-sm text-text-secondary">{item.email}</div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm text-text-muted">
        <div>
          <span className="text-text-secondary">Alliance:</span> {item.allianceName ?? "—"}
        </div>
        <div>
          <span className="text-text-secondary">Submitted:</span> {formatDateTime(item.createdAt)}
        </div>
        {item.betaWave && (
          <div>
            <span className="text-text-secondary">Wave:</span> {item.betaWave}
          </div>
        )}
        {item.lastStateChangeAt && (
          <div className="md:col-span-2">
            <span className="text-text-secondary">Last decision:</span> {formatDateTime(item.lastStateChangeAt)}
            {item.lastStateChangeActorEmail
              ? ` by ${formatActorLabel(item.lastStateChangeActorEmail, item.lastStateChangeActorDisplayName)}`
              : ""}
          </div>
        )}
        {item.currentReason && (
          <div className="md:col-span-2">
            <span className="text-text-secondary">Reason:</span> {item.currentReason}
          </div>
        )}
      </div>

      {item.message && (
        <p className="text-sm text-text-primary whitespace-pre-wrap break-words">{item.message}</p>
      )}

      <Button
        type="button"
        variant="link"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        data-testid={`access-request-toggle-${item.accessRequestId}`}
      >
        {open ? "Hide" : "Review"}
      </Button>

      {open && (
        <AccessRequestActionsPanel
          item={item}
          waveOptionsState={waveOptionsState}
          onRequestWaveOptions={onRequestWaveOptions}
        />
      )}
    </>
  );
}

/**
 * Single client boundary for the whole queue body (#177), unlike
 * FeedbackList.tsx's independent per-row exports — every row's beta-wave
 * combobox needs the SAME bounded options list loaded exactly once (design
 * decision 3), so the loader/cache has to live above all rows, not inside
 * one of them.
 */
export function AccessRequestList({ items }: { items: AccessRequestInboxListItem[] }) {
  const [waveOptionsState, setWaveOptionsState] = useState<WaveOptionsState>({ status: "idle" });

  // Transitions "idle"/"error" -> "loading"; a no-op while already loading
  // or loaded. Also serves as the Retry affordance: calling this again from
  // the "error" state re-enters "loading" and the effect below refetches.
  const ensureWaveOptionsLoaded = useCallback(() => {
    setWaveOptionsState((prev) =>
      prev.status === "loading" || prev.status === "loaded" ? prev : { status: "loading" },
    );
  }, []);

  useEffect(() => {
    if (waveOptionsState.status !== "loading") return;
    let cancelled = false;
    fetchBetaWaveOptionsAction()
      .then((result) => {
        if (cancelled) return;
        setWaveOptionsState(
          result.success
            ? { status: "loaded", waves: result.waves }
            : { status: "error", message: result.error },
        );
      })
      .catch((err) => {
        if (cancelled) return;
        // fetchBetaWaveOptionsAction rejects outright when requirePlatformAdmin
        // throws (e.g. an expired session), rather than resolving with
        // { success: false } — both land in the same retryable "error" state
        // so no row's combobox is stuck loading forever (review feedback).
        setWaveOptionsState({
          status: "error",
          message: err instanceof Error ? err.message : "Failed to load beta waves",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [waveOptionsState.status]);

  return (
    <section>
      <div className="md:hidden space-y-3">
        {items.map((item) => (
          <article
            key={item.accessRequestId}
            className="rounded-lg border border-border bg-surface p-4 space-y-3"
            data-testid={`access-request-card-${item.accessRequestId}`}
          >
            <AccessRequestRowBody
              item={item}
              waveOptionsState={waveOptionsState}
              onRequestWaveOptions={ensureWaveOptionsLoaded}
            />
          </article>
        ))}
      </div>
      <div className="hidden md:block bg-surface rounded-lg border border-border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="text-left py-3 px-4 text-text-muted font-medium">Access request</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr
                key={item.accessRequestId}
                className="border-b border-border align-top"
                data-testid={`access-request-row-${item.accessRequestId}`}
              >
                <td className="py-4 px-4 space-y-3">
                  <AccessRequestRowBody
                    item={item}
                    waveOptionsState={waveOptionsState}
                    onRequestWaveOptions={ensureWaveOptionsLoaded}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
