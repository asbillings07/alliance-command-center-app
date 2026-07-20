"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MetricPeriodForm } from "./metricPeriodForm";
import { archiveMetricPeriod, restoreMetricPeriod } from "./action";
import { MetricPeriodMetric } from "@/app/generated/prisma/client";
import { Metric } from "@/app/generated/prisma/client";
import { Card, Badge } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type MetricPeriodData = {
  id: string;
  name: string;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  periodKey: string;
  periodMetrics: (MetricPeriodMetric & { metric: Metric })[];
};

type MetricPeriodCardProps = {
  allianceId: string;
  mode: "create" | "view";
  period?: MetricPeriodData;
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "Not set";
  return new Date(`${dateStr}T00:00:00`).toLocaleDateString();
}

export function MetricPeriodCard({
  allianceId,
  mode,
  period,
}: MetricPeriodCardProps) {
  const router = useRouter();
  const [cardState, setCardState] = useState<"closed" | "form" | "view">(
    mode === "create" ? "closed" : "view"
  );
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const handleArchive = () => {
    setError(null);
    const formData = new FormData();
    formData.set("periodId", period?.id || "");
    formData.set("allianceId", allianceId);

    startTransition(async () => {
      const result = await archiveMetricPeriod(formData);
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
    formData.set("periodId", period?.id || "");
    formData.set("allianceId", allianceId);

    startTransition(async () => {
      const result = await restoreMetricPeriod(formData);
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
        <div className="w-full" data-tour="create-period">
          <button
            type="button"
            onClick={() => setCardState("form")}
            className="w-full rounded-md border-2 border-dashed border-border p-4 text-text-secondary hover:border-primary hover:text-primary cursor-pointer transition-colors"
          >
            + Create Period
          </button>
        </div>
      );
    }

    return (
      <div className="w-full" data-tour="create-period">
        <MetricPeriodForm
          allianceId={allianceId}
          mode="create"
          onCancel={() => setCardState("closed")}
        />
      </div>
    );
  }

  if (!period) return null;

  if (cardState === "form") {
    return (
      <MetricPeriodForm
        key={period.periodKey}
        allianceId={allianceId}
        mode="edit"
        periodId={period.id}
        name={period.name}
        startsAt={period.startsAt || undefined}
        endsAt={period.endsAt || undefined}
        onCancel={() => setCardState("view")}
      />
    );
  }

  return (
    <Card className={!period.active ? "opacity-60" : ""}>
      <Card.Body>
        {error && (
          <div className="mb-3 p-2 bg-danger/10 border border-danger rounded text-sm text-danger">
            {error}
          </div>
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <h2 className="text-lg font-semibold text-primary">{period.name}</h2>
              {!period.active && (
                <Badge variant="neutral" size="sm">
                  Archived
                </Badge>
              )}
            </div>
            <div className="text-sm text-text-secondary flex gap-4 mb-2">
              <span>Start: {formatDate(period.startsAt)}</span>
              <span>End: {formatDate(period.endsAt)}</span>
            </div>
            <Button
              variant="link"
              size="sm"
              href={`/alliances/${allianceId}/periods/${period.id}`}
            >
              Configure Metrics
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {period.active && (
              <Button
                variant="link"
                size="sm"
                onClick={() => setCardState("form")}
                disabled={isPending}
              >
                Edit
              </Button>
            )}
            {period.active ? (
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
  );
}
