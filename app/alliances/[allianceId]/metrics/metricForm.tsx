"use client";

import { useState, useTransition, useRef } from "react";
import { Metric_Type } from "@/app/generated/prisma/enums";
import { createMetric, editMetric } from "./action";
import { Card } from "@/app/src/components";
import { Button, Input, Textarea, Select, Label } from "@/app/src/components/client";

type MetricFormProps = {
  allianceId: string;
  mode: "create" | "edit";
  metricId?: string;
  name?: string;
  description?: string;
  type?: Metric_Type;
  onCancel: () => void;
};

export function MetricForm({
  allianceId,
  mode,
  metricId,
  name = "",
  description = "",
  type = Metric_Type.NUMERIC,
  onCancel,
}: MetricFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

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
              defaultValue={type}
              disabled={isPending}
            >
              <option value={Metric_Type.NUMERIC}>Numeric</option>
              <option value={Metric_Type.BOOLEAN}>Boolean</option>
            </Select>
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
