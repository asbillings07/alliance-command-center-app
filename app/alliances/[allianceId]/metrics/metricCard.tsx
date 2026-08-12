"use client";

import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MetricForm } from "./metricForm";
import { archiveMetric, restoreMetric } from "./action";
import { Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type MetricData = {
  id: string;
  name: string;
  description: string | null;
  type: Metric_Type;
  summaryKind: MetricSummaryKind;
  unitLabel: string | null;
  trendDirection: MetricTrendDirection;
  active: boolean;
  metricKey: string;
};

type MetricCardProps = {
  allianceId: string;
  mode: "create" | "view";
  metric?: MetricData;
  returnTo?: string;
  targetPeriodId?: string | null;
  // reports ships dark (#190): this is a client component, so the flag can't
  // be evaluated here directly — the server parent resolves it once and
  // passes the result down.
  showReportLink?: boolean;
};

const METRIC_TYPE_VARIANTS: Record<Metric_Type, { label: string; variant: "info" | "success" }> = {
  [Metric_Type.NUMERIC]: { label: "Numeric", variant: "info" },
  [Metric_Type.BOOLEAN]: { label: "Boolean", variant: "success" },
};

const SUMMARY_KIND_BADGE_LABELS: Record<MetricSummaryKind, string> = {
  [MetricSummaryKind.NONE]: "No rollup",
  [MetricSummaryKind.SUM]: "Total",
  [MetricSummaryKind.AVERAGE]: "Average",
  [MetricSummaryKind.TRUE_RATE]: "True rate",
};

const TREND_DIRECTION_BADGE_LABELS: Record<MetricTrendDirection, string> = {
  [MetricTrendDirection.NEUTRAL]: "Neutral",
  [MetricTrendDirection.HIGHER_IS_BETTER]: "Higher is better",
  [MetricTrendDirection.LOWER_IS_BETTER]: "Lower is better",
};

export function MetricCard({
  allianceId,
  mode,
  metric,
  returnTo,
  targetPeriodId = null,
  showReportLink = false,
}: MetricCardProps) {
  const router = useRouter();
  const [cardState, setCardState] = useState<"closed" | "form" | "view" | "created">(
    mode === "create" ? "closed" : "view"
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleArchive = () => {
    setError(null);
    const formData = new FormData();
    formData.set("metricId", metric?.id || "");
    formData.set("allianceId", allianceId);

    startTransition(async () => {
      const result = await archiveMetric(formData);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  const handleRestore = () => {
    setError(null);
    const formData = new FormData();
    formData.set("metricId", metric?.id || "");
    formData.set("allianceId", allianceId);

    startTransition(async () => {
      const result = await restoreMetric(formData);
      if (result.error) {
        setError(result.error);
      } else {
        router.refresh();
      }
    });
  };

  if (mode === "create") {
    if (cardState === "closed") {
      return (
        <div className="w-full">
          <button
            type="button"
            onClick={() => setCardState("form")}
            className="w-full rounded-md border-2 border-dashed border-border p-4 text-text-secondary hover:border-primary hover:text-primary cursor-pointer transition-colors"
          >
            + Create Metric
          </button>
        </div>
      );
    }

    return (
      <div className="w-full flex flex-col gap-3">
        {cardState === "created" ? (
          <>
            <div className="rounded-md border border-success/30 bg-success/10 p-4 text-sm text-text-primary">
              {returnTo
                ? "Metric created. Attach it to your evaluation period to complete setup."
                : "Metric created. Attach it to an evaluation period to start recording results."}
            </div>
            {returnTo ? (
              <Button variant="primary" href={returnTo}>
                Continue configuring this period
              </Button>
            ) : targetPeriodId ? (
              <Button
                variant="primary"
                href={`/alliances/${allianceId}/periods/${targetPeriodId}`}
              >
                Attach to evaluation period
              </Button>
            ) : (
              <>
                <p className="text-sm text-text-secondary">
                  Create an evaluation period first, then attach this metric to it.
                </p>
                <Button variant="primary" href={`/alliances/${allianceId}/periods`}>
                  Go to Evaluation Periods
                </Button>
              </>
            )}
            <button
              type="button"
              onClick={() => setCardState("form")}
              className="text-sm text-text-muted hover:text-text-primary self-start"
            >
              Create another metric
            </button>
          </>
        ) : (
          <MetricForm
            allianceId={allianceId}
            mode="create"
            returnTo={returnTo}
            onCancel={() => setCardState("closed")}
            onSuccess={() => {
              router.refresh();
              setCardState("created");
            }}
          />
        )}
      </div>
    );
  }

  if (!metric) return null;

  const typeInfo = METRIC_TYPE_VARIANTS[metric.type] || METRIC_TYPE_VARIANTS[Metric_Type.NUMERIC];

  if (cardState === "form") {
    return (
      <MetricForm
        key={metric.metricKey}
        allianceId={allianceId}
        mode="edit"
        metricId={metric.id}
        name={metric.name}
        description={metric.description || ""}
        type={metric.type}
        summaryKind={metric.summaryKind}
        unitLabel={metric.unitLabel}
        trendDirection={metric.trendDirection}
        onCancel={() => setCardState("view")}
      />
    );
  }

  return (
    <div data-testid={`metric-card-${metric.id}`}>
    <Card className={!metric.active ? "opacity-60" : ""}>
      <Card.Body>
        {error && (
          <div className="mb-3 p-2 bg-danger/10 border border-danger rounded text-sm text-danger">
            {error}
          </div>
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg font-semibold text-primary">{metric.name}</h2>
              <Badge variant={typeInfo.variant} size="sm">
                {typeInfo.label}
              </Badge>
              {metric.summaryKind !== MetricSummaryKind.NONE && (
                <Badge variant="neutral" size="sm">
                  {SUMMARY_KIND_BADGE_LABELS[metric.summaryKind]}
                  {metric.unitLabel ? ` (${metric.unitLabel})` : ""}
                </Badge>
              )}
              {metric.trendDirection !== MetricTrendDirection.NEUTRAL && (
                <Badge variant="neutral" size="sm">
                  {TREND_DIRECTION_BADGE_LABELS[metric.trendDirection]}
                </Badge>
              )}
              {!metric.active && (
                <Badge variant="neutral" size="sm">
                  Archived
                </Badge>
              )}
            </div>
            {metric.description && (
              <p className="text-text-secondary">{metric.description}</p>
            )}
          </div>
          <div className="flex items-center gap-2">
            {showReportLink && (
              <Button href={`/alliances/${allianceId}/reports/metrics/${metric.id}`} variant="link" size="sm">
                View Report
              </Button>
            )}
            {metric.active && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setCardState("form")}
                disabled={isPending}
              >
                Edit
              </Button>
            )}
            {metric.active ? (
              <Button
                variant="warning-link"
                size="sm"
                onClick={handleArchive}
                disabled={isPending}
              >
                {isPending ? "Archiving..." : "Archive"}
              </Button>
            ) : (
              <Button
                variant="success-link"
                size="sm"
                onClick={handleRestore}
                disabled={isPending}
              >
                {isPending ? "Restoring..." : "Restore"}
              </Button>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
    </div>
  );
}
