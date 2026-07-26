"use client";

import { Input, Label } from "@/app/src/components/client";

export type MetricPeriodFieldsProps = {
  name: string;
  startsAt: string;
  endsAt: string;
  onNameChange: (value: string) => void;
  onStartsAtChange: (value: string) => void;
  onEndsAtChange: (value: string) => void;
  disabled?: boolean;
};

export function MetricPeriodFields({
  name,
  startsAt,
  endsAt,
  onNameChange,
  onStartsAtChange,
  onEndsAtChange,
  disabled = false,
}: MetricPeriodFieldsProps) {
  return (
    <>
      <div>
        <Label htmlFor="name" required>
          Name
        </Label>
        <Input
          id="name"
          name="name"
          type="text"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          disabled={disabled}
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
            value={startsAt}
            onChange={(e) => onStartsAtChange(e.target.value)}
            disabled={disabled}
          />
        </div>

        <div>
          <Label htmlFor="endsAt">End Date (optional)</Label>
          <Input
            id="endsAt"
            name="endsAt"
            type="date"
            value={endsAt}
            onChange={(e) => onEndsAtChange(e.target.value)}
            disabled={disabled}
          />
        </div>
      </div>
    </>
  );
}
