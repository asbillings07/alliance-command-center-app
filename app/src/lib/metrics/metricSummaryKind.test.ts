import { describe, it, expect } from "vitest";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import {
  isValidSummaryKindForType,
  describeSummaryKindMismatch,
  validateUnitLabel,
  METRIC_UNIT_LABEL_MAX_LENGTH,
} from "./metricSummaryKind";

describe("isValidSummaryKindForType", () => {
  it.each([MetricSummaryKind.NONE, MetricSummaryKind.SUM, MetricSummaryKind.AVERAGE])(
    "allows %s for NUMERIC",
    (kind) => {
      expect(isValidSummaryKindForType(Metric_Type.NUMERIC, kind)).toBe(true);
    },
  );

  it("rejects TRUE_RATE for NUMERIC", () => {
    expect(isValidSummaryKindForType(Metric_Type.NUMERIC, MetricSummaryKind.TRUE_RATE)).toBe(
      false,
    );
  });

  it.each([MetricSummaryKind.NONE, MetricSummaryKind.TRUE_RATE])(
    "allows %s for BOOLEAN",
    (kind) => {
      expect(isValidSummaryKindForType(Metric_Type.BOOLEAN, kind)).toBe(true);
    },
  );

  it.each([MetricSummaryKind.SUM, MetricSummaryKind.AVERAGE])(
    "rejects %s for BOOLEAN",
    (kind) => {
      expect(isValidSummaryKindForType(Metric_Type.BOOLEAN, kind)).toBe(false);
    },
  );
});

describe("describeSummaryKindMismatch", () => {
  it("explains SUM requires Numeric", () => {
    expect(describeSummaryKindMismatch(Metric_Type.BOOLEAN, MetricSummaryKind.SUM)).toMatch(
      /Numeric/,
    );
  });

  it("explains AVERAGE requires Numeric", () => {
    expect(describeSummaryKindMismatch(Metric_Type.BOOLEAN, MetricSummaryKind.AVERAGE)).toMatch(
      /Numeric/,
    );
  });

  it("explains TRUE_RATE requires Boolean", () => {
    expect(describeSummaryKindMismatch(Metric_Type.NUMERIC, MetricSummaryKind.TRUE_RATE)).toMatch(
      /Boolean/,
    );
  });
});

describe("validateUnitLabel", () => {
  it("accepts null/undefined as no label", () => {
    expect(validateUnitLabel(null)).toEqual({ ok: true, value: null });
    expect(validateUnitLabel(undefined)).toEqual({ ok: true, value: null });
  });

  it("normalizes empty/whitespace-only input to null (not an error)", () => {
    expect(validateUnitLabel("")).toEqual({ ok: true, value: null });
    expect(validateUnitLabel("   ")).toEqual({ ok: true, value: null });
  });

  it("trims surrounding whitespace", () => {
    expect(validateUnitLabel("  pts  ")).toEqual({ ok: true, value: "pts" });
  });

  it("strips control characters", () => {
    expect(validateUnitLabel("pts\u0000\u001F")).toEqual({ ok: true, value: "pts" });
  });

  it("accepts a label at exactly the max length", () => {
    const value = "a".repeat(METRIC_UNIT_LABEL_MAX_LENGTH);
    expect(validateUnitLabel(value)).toEqual({ ok: true, value });
  });

  it("rejects a label over the max length", () => {
    const value = "a".repeat(METRIC_UNIT_LABEL_MAX_LENGTH + 1);
    const result = validateUnitLabel(value);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toMatch(new RegExp(`${METRIC_UNIT_LABEL_MAX_LENGTH}`));
    }
  });
});
