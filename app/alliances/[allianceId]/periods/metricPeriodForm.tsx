"use client";

import { useState, useTransition } from "react";
import { createMetricPeriod, editMetricPeriod } from "./action";
import { Card, Button, Input, Label } from "@/app/src/components";

type MetricPeriodFormProps = {
  allianceId: string;
  mode: "create" | "edit";
  periodId?: string;
  name?: string;
  startsAt?: string;
  endsAt?: string;
  onCancel: () => void;
};

function formatDateForInput(date: string | null | undefined): string {
  if (!date) return "";
  return date;
}

export function MetricPeriodForm({
  allianceId,
  mode,
  periodId,
  name = "",
  startsAt,
  endsAt,
  onCancel,
}: MetricPeriodFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submitLabel = mode === "create" ? "Create Period" : "Update Period";
  const pendingLabel = mode === "create" ? "Creating..." : "Updating...";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      const action = mode === "create" ? createMetricPeriod : editMetricPeriod;
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
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="allianceId" value={allianceId} />
          {mode === "edit" && periodId && (
            <input type="hidden" name="periodId" value={periodId} />
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
              placeholder="e.g., Season 7, Q1 2026"
              required
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="startsAt">Start Date (optional)</Label>
              <Input
                id="startsAt"
                name="startsAt"
                type="date"
                defaultValue={formatDateForInput(startsAt)}
                disabled={isPending}
              />
            </div>

            <div>
              <Label htmlFor="endsAt">End Date (optional)</Label>
              <Input
                id="endsAt"
                name="endsAt"
                type="date"
                defaultValue={formatDateForInput(endsAt)}
                disabled={isPending}
              />
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
