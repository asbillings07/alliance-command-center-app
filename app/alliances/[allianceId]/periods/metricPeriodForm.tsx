"use client";

import { useState, useTransition } from "react";
import { createMetricPeriod, editMetricPeriod } from "./action";
import { MetricPeriodFields } from "./MetricPeriodFields";
import { Card } from "@/app/src/components";
import { Button } from "@/app/src/components/client";

type MetricPeriodFormProps = {
  allianceId: string;
  mode: "create" | "edit";
  periodId?: string;
  name?: string;
  startsAt?: string;
  endsAt?: string;
  onCancel: () => void;
  onSuccess?: (periodId: string) => void;
};

function formatDateForInput(date: string | null | undefined): string {
  if (!date) return "";
  return date;
}

export function MetricPeriodForm({
  allianceId,
  mode,
  periodId,
  name: initialName = "",
  startsAt: initialStartsAt,
  endsAt: initialEndsAt,
  onCancel,
  onSuccess,
}: MetricPeriodFormProps) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState(initialName);
  const [startsAt, setStartsAt] = useState(formatDateForInput(initialStartsAt));
  const [endsAt, setEndsAt] = useState(formatDateForInput(initialEndsAt));

  const submitLabel = mode === "create" ? "Create Period" : "Update Period";
  const pendingLabel = mode === "create" ? "Creating..." : "Updating...";

  const handleSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);

    startTransition(async () => {
      if (mode === "create") {
        const result = await createMetricPeriod(formData);
        if (!result.success) {
          setError(result.error);
        } else if (onSuccess) {
          onSuccess(result.periodId);
        } else {
          onCancel();
        }
        return;
      }

      const result = await editMetricPeriod(formData);
      if (!result.success) {
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

          <MetricPeriodFields
            name={name}
            startsAt={startsAt}
            endsAt={endsAt}
            onNameChange={setName}
            onStartsAtChange={setStartsAt}
            onEndsAtChange={setEndsAt}
            disabled={isPending}
          />

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
