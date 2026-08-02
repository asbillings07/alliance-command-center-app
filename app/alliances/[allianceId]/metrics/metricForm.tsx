"use client";

import { useState, useTransition, useRef } from "react";
import { Metric_Type, MetricSummaryKind, MetricTrendDirection } from "@/app/generated/prisma/enums";
import { createMetric, editMetric } from "./action";
import { METRIC_SUMMARY_KINDS_BY_TYPE } from "@/app/src/lib/metrics/metricSummaryKind";
import { METRIC_TREND_DIRECTION_LABELS } from "@/app/src/lib/metrics/metricTrendDirection";
import { Card } from "@/app/src/components";
import { Button, Input, Textarea, Select, Label } from "@/app/src/components/client";

type MetricFormProps = {
  allianceId: string;
  mode: "create" | "edit";
  metricId?: string;
  name?: string;
  description?: string;
  type?: Metric_Type;
  summaryKind?: MetricSummaryKind;
  unitLabel?: string | null;
  trendDirection?: MetricTrendDirection;
  returnTo?: string;
  onCancel: () => void;
  onSuccess?: () => void;
};

const SUMMARY_KIND_LABELS: Record<MetricSummaryKind, string> = {
  [MetricSummaryKind.NONE]: "No rollup",
  [MetricSummaryKind.SUM]: "Total (sum across members)",
  [MetricSummaryKind.AVERAGE]: "Average across members",
  [MetricSummaryKind.TRUE_RATE]: "True rate (% yes)",
};

export function MetricForm({
  allianceId,
  mode,
  metricId,
  name = "",
  description = "",
  type = Metric_Type.NUMERIC,
  summaryKind = MetricSummaryKind.NONE,
  unitLabel = "",
  trendDirection = MetricTrendDirection.NEUTRAL,
  returnTo,
  onCancel,
  onSuccess,
}: MetricFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Type is immutable after creation (#190): on create, the type select is
  // interactive and its choice drives which summary kinds are offered below.
  // On edit, type is disabled and fixed to the metric's existing type.
  const [selectedType, setSelectedType] = useState<Metric_Type>(type);
  const [selectedSummaryKind, setSelectedSummaryKind] =
    useState<MetricSummaryKind>(summaryKind);
  const availableSummaryKinds = METRIC_SUMMARY_KINDS_BY_TYPE[selectedType];

  const submitLabel = mode === "create" ? "Create Metric" : "Update Metric";
  const pendingLabel = mode === "create" ? "Creating..." : "Updating...";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRef.current) return;

    setError(null);
    const formData = new FormData(formRef.current);

    startTransition(async () => {
      const action = mode === "create" ? createMetric : editMetric;
      const result = await action(formData);

      if (result.error) {
        setError(result.error);
      } else if (onSuccess) {
        onSuccess();
      } else {
        onCancel();
      }
    });
  };

  return (
    <Card>
      <Card.Body>
        <form
          ref={formRef}
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="allianceId" value={allianceId} />
          {mode === "edit" && metricId && (
            <input type="hidden" name="metricId" value={metricId} />
          )}

          {error && (
            <div className="p-3 bg-danger/10 border border-danger rounded-md text-sm text-danger">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="name" required>Name</Label>
            <Input
              id="name"
              name="name"
              type="text"
              defaultValue={name}
              disabled={isPending}
              placeholder="e.g., VS Score"
              required
            />
          </div>

          <div>
            <Label htmlFor="description">Description (optional)</Label>
            <Textarea
              id="description"
              name="description"
              rows={2}
              disabled={isPending}
              placeholder="Describe what this metric measures..."
              defaultValue={description}
            />
          </div>

          <div>
            <Label htmlFor="type">Type</Label>
            <Select
              id="type"
              name="type"
              value={selectedType}
              disabled={isPending || mode === "edit"}
              onChange={(e) => {
                const nextType = e.target.value as Metric_Type;
                setSelectedType(nextType);
                // Reset the summary kind if it's no longer valid for the
                // newly selected type, so the form can never submit an
                // incompatible (type, summaryKind) pair.
                if (!METRIC_SUMMARY_KINDS_BY_TYPE[nextType].includes(selectedSummaryKind)) {
                  setSelectedSummaryKind(MetricSummaryKind.NONE);
                }
              }}
            >
              <option value={Metric_Type.NUMERIC}>Numeric</option>
              <option value={Metric_Type.BOOLEAN}>Boolean</option>
            </Select>
            {mode === "edit" && (
              <p className="mt-1 text-sm text-text-muted">
                Type cannot be changed after creation — archive this metric and create a new
                one instead.
              </p>
            )}
          </div>

          <div className="border-t border-border pt-4 flex flex-col gap-4">
            <h3 className="text-sm font-semibold text-text-secondary">Reporting</h3>
            <div>
              <Label htmlFor="summaryKind">Summary</Label>
              <Select
                id="summaryKind"
                name="summaryKind"
                value={selectedSummaryKind}
                disabled={isPending}
                onChange={(e) =>
                  setSelectedSummaryKind(e.target.value as MetricSummaryKind)
                }
              >
                {availableSummaryKinds.map((kind) => (
                  <option key={kind} value={kind}>
                    {SUMMARY_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-sm text-text-muted">
                Controls how this metric&apos;s per-metric report rolls up member values.
              </p>
            </div>
            <div>
              <Label htmlFor="unitLabel">Unit label (optional)</Label>
              <Input
                id="unitLabel"
                name="unitLabel"
                type="text"
                defaultValue={unitLabel ?? ""}
                disabled={isPending}
                placeholder="e.g., pts, donations"
                maxLength={24}
              />
            </div>
            <div>
              <Label htmlFor="trendDirection">Trend direction</Label>
              <Select
                id="trendDirection"
                name="trendDirection"
                defaultValue={trendDirection}
                disabled={isPending}
              >
                {Object.values(MetricTrendDirection).map((direction) => (
                  <option key={direction} value={direction}>
                    {METRIC_TREND_DIRECTION_LABELS[direction]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-sm text-text-muted">
                Tells the reports &quot;needs attention&quot; findings whether a period-over-period
                change is worth flagging. Only used when this metric has a rollup to compare
                (Total, Average, or True rate) — leave as Neutral unless you know which direction
                means better.
              </p>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isPending}
            >
              {isPending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </Card.Body>
    </Card>
  );
}
