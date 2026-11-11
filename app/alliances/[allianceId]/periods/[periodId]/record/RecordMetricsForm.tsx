"use client";

import { useState, useTransition } from "react";
import { recordMemberMetrics } from "./action";

type MemberOption = {
  id: string;
  playerName: string;
};

type MetricOption = {
  id: string;
  name: string;
};

type RecordMetricsFormProps = {
  periodId: string;
  allianceId: string;
  members: MemberOption[];
  metrics: MetricOption[];
};

function isValidInteger(value: string): boolean {
  if (value === "") return true;
  return /^-?\d+$/.test(value);
}

export function RecordMetricsForm({
  periodId,
  allianceId,
  members,
  metrics,
}: RecordMetricsFormProps) {
  const [selectedMetricId, setSelectedMetricId] = useState(
    metrics[0]?.id || ""
  );
  const [isPending, startTransition] = useTransition();
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ count: number } | null>(null);

  const handleValueChange = (memberId: string, value: string) => {
    setValues((prev) => ({ ...prev, [memberId]: value }));
    setError(null);
    setSuccess(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    const invalidEntries: string[] = [];
    const filledEntries = Object.entries(values).filter(
      ([, value]) => value !== ""
    );

    for (const [memberId, value] of filledEntries) {
      if (!isValidInteger(value)) {
        const member = members.find((m) => m.id === memberId);
        invalidEntries.push(member?.playerName || memberId);
      }
    }

    if (invalidEntries.length > 0) {
      setError(
        `Invalid values for: ${invalidEntries.join(", ")}. Please enter whole numbers only.`
      );
      return;
    }

    const entries = filledEntries.map(([memberId, value]) => ({
      memberId,
      value: parseInt(value, 10),
    }));

    if (entries.length === 0) {
      setError("Please enter at least one value");
      return;
    }

    startTransition(async () => {
      try {
        await recordMemberMetrics({
          periodId,
          metricId: selectedMetricId,
          allianceId,
          entries,
        });
        setSuccess({ count: entries.length });
        setValues({});
        setError(null);
      } catch (err) {
        console.error("Failed to record metrics:", err);
        setError("Failed to record metrics. Please try again.");
      }
    });
  };

  const selectedMetric = metrics.find((m) => m.id === selectedMetricId);

  return (
    <form onSubmit={handleSubmit} className="w-full max-w-2xl flex flex-col gap-4">
      <div>
        <label
          htmlFor="metricId"
          className="block text-sm font-medium text-text-secondary mb-1"
        >
          Select Metric
        </label>
        <select
          name="metricId"
          id="metricId"
          value={selectedMetricId}
          onChange={(e) => {
            setSelectedMetricId(e.target.value);
            setValues({});
            setSuccess(null);
          }}
          disabled={isPending}
          className="w-full rounded-md border border-border bg-surface-secondary text-text-primary p-2 focus:outline-none focus:ring-2 focus:ring-primary disabled:text-text-disabled"
        >
          {metrics.map((metric) => (
            <option key={metric.id} value={metric.id}>
              {metric.name}
            </option>
          ))}
        </select>
      </div>

      <hr className="border-border" />

      <h3 className="text-lg font-semibold">
        Record {selectedMetric?.name || "Metric"} for Members
      </h3>

      {success && (
        <div className="p-3 rounded-md bg-success/10 border border-success/30 text-success-light text-sm flex items-center gap-2">
          <svg
            className="w-5 h-5 text-success-light"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M5 13l4 4L19 7"
            />
          </svg>
          Recorded {success.count} {success.count === 1 ? "entry" : "entries"}{" "}
          successfully
        </div>
      )}

      <div className="flex flex-col gap-2">
        {members.map((member) => {
          const value = values[member.id] || "";
          const isInvalid = value !== "" && !isValidInteger(value);
          return (
            <div
              key={member.id}
              className="flex items-center justify-between gap-3 p-3 border border-border bg-surface rounded-md"
            >
              <label htmlFor={`value-${member.id}`} className="font-medium">
                {member.playerName}
              </label>
              <div className="flex flex-col items-end">
                <input
                  type="text"
                  id={`value-${member.id}`}
                  value={value}
                  onChange={(e) => handleValueChange(member.id, e.target.value)}
                  placeholder="Enter value"
                  disabled={isPending}
                  className={`w-32 rounded-md border p-2 text-right text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary disabled:text-text-disabled ${
                    isInvalid ? "border-danger bg-danger/10" : "border-border bg-surface-secondary"
                  }`}
                />
                {isInvalid && (
                  <span className="text-xs text-danger-light mt-1">
                    Must be a whole number
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <div className="p-3 rounded-md bg-danger/10 border border-danger/30 text-danger-light text-sm">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="px-4 py-2 rounded-md bg-primary-hover text-white hover:bg-primary-active cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isPending ? "Saving..." : "Save All"}
      </button>
    </form>
  );
}
