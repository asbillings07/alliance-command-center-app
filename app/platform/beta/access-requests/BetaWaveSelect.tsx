"use client";

import { useEffect, useId, useRef } from "react";
import { Input, Label, Select } from "@/app/src/components/client";
import type { BetaWaveOption } from "@/app/src/lib/platform/accessRequestInbox";

/**
 * Explicit client-side representation of the beta-wave choice (#177 design
 * decision). `{ kind: "none" }` is the default and the only invalid state —
 * never inferred from an empty string, so there is no ambiguity between
 * "nothing chosen yet" and "chose an empty wave".
 */
export type WaveChoice =
  | { kind: "none" }
  | { kind: "existing"; value: string }
  | { kind: "new"; value: string };

export const WAVE_LABEL_MIN = 1;
export const WAVE_LABEL_MAX = 80;

const NONE_OPTION_VALUE = "";
const CREATE_OPTION_VALUE = "create";
const EXISTING_OPTION_PREFIX = "existing:";

export function isWaveChoiceValid(
  choice: WaveChoice,
): choice is Extract<WaveChoice, { kind: "existing" | "new" }> {
  if (choice.kind === "none") return false;
  const length = choice.value.trim().length;
  return length >= WAVE_LABEL_MIN && length <= WAVE_LABEL_MAX;
}

/** The exact value to submit to the server — the real wave name, never a UI sentinel. */
export function getWaveSubmitValue(choice: WaveChoice): string | null {
  if (!isWaveChoiceValid(choice)) return null;
  return choice.value.trim();
}

export const NONE_WAVE_CHOICE: WaveChoice = { kind: "none" };

type BetaWaveSelectProps = {
  /** Unique per-row prefix so ids/testids never collide across multiple open panels. */
  idPrefix: string;
  /** null = not loaded yet (shows just the blank + "Create new wave…" options). */
  waveOptions: BetaWaveOption[] | null;
  /** Called once on mount to trigger the shared, page-level lazy load. Safe to call more than once. */
  onRequestOptions: () => void;
  value: WaveChoice;
  onChange: (choice: WaveChoice) => void;
  disabled?: boolean;
};

export function BetaWaveSelect({
  idPrefix,
  waveOptions,
  onRequestOptions,
  value,
  onChange,
  disabled,
}: BetaWaveSelectProps) {
  const reactId = useId();
  const selectId = `${idPrefix}-wave-select-${reactId}`;
  const newInputId = `${idPrefix}-wave-new-${reactId}`;
  const helpId = `${idPrefix}-wave-help-${reactId}`;
  const errorId = `${idPrefix}-wave-error-${reactId}`;
  const selectRef = useRef<HTMLSelectElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const requestedRef = useRef(false);
  const previousKindRef = useRef(value.kind);

  useEffect(() => {
    if (!requestedRef.current) {
      requestedRef.current = true;
      onRequestOptions();
    }
    // Intentionally runs once per mount — onRequestOptions is idempotent
    // (guarded by the shared loader) and re-running it on every re-render
    // would defeat the "load once" requirement.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isCreating = value.kind === "new";

  useEffect(() => {
    if (isCreating) {
      newInputRef.current?.focus();
    }
  }, [isCreating]);

  // Restore focus to the select whenever the choice leaves "new" mode,
  // whether that happened via the select itself (already focused, harmless)
  // or via an external reset (panel Cancel/Success) that never touched the
  // select directly (#177 design decision).
  useEffect(() => {
    if (previousKindRef.current === "new" && value.kind !== "new") {
      selectRef.current?.focus();
    }
    previousKindRef.current = value.kind;
  }, [value.kind]);

  const options = waveOptions ?? [];

  let selectValue: string = NONE_OPTION_VALUE;
  if (isCreating) {
    selectValue = CREATE_OPTION_VALUE;
  } else if (value.kind === "existing") {
    const index = options.findIndex((option) => option.name === value.value);
    selectValue = index >= 0 ? `${EXISTING_OPTION_PREFIX}${index}` : NONE_OPTION_VALUE;
  }

  const handleSelectChange = (raw: string) => {
    if (raw === NONE_OPTION_VALUE) {
      onChange({ kind: "none" });
      return;
    }
    if (raw === CREATE_OPTION_VALUE) {
      onChange({ kind: "new", value: "" });
      return;
    }
    const index = Number.parseInt(raw.slice(EXISTING_OPTION_PREFIX.length), 10);
    const option = options[index];
    onChange(option ? { kind: "existing", value: option.name } : { kind: "none" });
  };

  const showLengthError = isCreating && value.value.length > 0 && !isWaveChoiceValid(value);

  return (
    <div className="space-y-2">
      <Label htmlFor={selectId} required>
        Beta wave
      </Label>
      <Select
        id={selectId}
        ref={selectRef}
        value={selectValue}
        onChange={(e) => handleSelectChange(e.target.value)}
        disabled={disabled}
        aria-describedby={helpId}
        data-testid={`${idPrefix}-wave-select`}
      >
        <option value={NONE_OPTION_VALUE}>Select a beta wave…</option>
        {options.map((option, index) => (
          <option key={option.id} value={`${EXISTING_OPTION_PREFIX}${index}`}>
            {option.name}
          </option>
        ))}
        <option value={CREATE_OPTION_VALUE}>Create new wave…</option>
      </Select>
      <p id={helpId} className="text-xs text-text-muted">
        Choose an existing wave, or create a new one. Required to approve and invite.
      </p>

      {isCreating && (
        <div className="space-y-1">
          <Label htmlFor={newInputId} required>
            New beta wave
          </Label>
          <Input
            ref={newInputRef}
            id={newInputId}
            value={value.value}
            onChange={(e) => onChange({ kind: "new", value: e.target.value })}
            disabled={disabled}
            required
            maxLength={WAVE_LABEL_MAX}
            aria-describedby={showLengthError ? errorId : helpId}
            placeholder="e.g., Wave 4, Founders cohort"
            data-testid={`${idPrefix}-wave-new-input`}
          />
          {showLengthError && (
            <p id={errorId} className="text-xs text-danger" data-testid={`${idPrefix}-wave-error`}>
              Beta wave must be {WAVE_LABEL_MIN}–{WAVE_LABEL_MAX} characters.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
