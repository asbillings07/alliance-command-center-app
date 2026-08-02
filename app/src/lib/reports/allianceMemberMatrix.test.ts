import { describe, it, expect } from "vitest";
import { Metric_Type } from "@/app/generated/prisma/enums";
import {
  resolveMatrixColumns,
  normalizeMatrixSort,
  buildCell,
  MATRIX_MAX_COLUMNS,
  type MatrixColumnCandidate,
} from "./allianceMemberMatrix";

function candidate(overrides: Partial<MatrixColumnCandidate> = {}): MatrixColumnCandidate {
  return {
    id: "met_1",
    name: "Donations",
    type: Metric_Type.NUMERIC,
    unitLabel: "pts",
    attachmentStatus: "ACTIVE",
    metricActive: true,
    ...overrides,
  };
}

function candidates(n: number): MatrixColumnCandidate[] {
  return Array.from({ length: n }, (_, i) => candidate({ id: `met_${i + 1}`, name: `Metric ${i + 1}` }));
}

describe("resolveMatrixColumns", () => {
  it("selects every candidate when there are MATRIX_MAX_COLUMNS or fewer and none were requested", () => {
    const all = candidates(4);
    expect(resolveMatrixColumns(all, undefined)).toEqual(all);
  });

  it("defaults to the first MATRIX_MAX_COLUMNS, in the candidates' own order, when there are more and none were requested", () => {
    const all = candidates(9);
    const resolved = resolveMatrixColumns(all, undefined);
    expect(resolved).toHaveLength(MATRIX_MAX_COLUMNS);
    expect(resolved.map((c) => c.id)).toEqual(["met_1", "met_2", "met_3", "met_4", "met_5", "met_6"]);
  });

  it("defaults the same way when requestedIds is an empty array", () => {
    const all = candidates(9);
    expect(resolveMatrixColumns(all, [])).toEqual(resolveMatrixColumns(all, undefined));
  });

  it("selects exactly the requested, valid columns, preserving the candidates' own order rather than the request's order", () => {
    const all = candidates(5);
    // Requested out of order and with a duplicate — resolved order must
    // still follow `all`'s order, and duplicates must not appear twice.
    const resolved = resolveMatrixColumns(all, ["met_3", "met_1", "met_1"]);
    expect(resolved.map((c) => c.id)).toEqual(["met_1", "met_3"]);
  });

  it("drops requested IDs that don't belong to the candidate universe (server-enforced, never trusts the client)", () => {
    const all = candidates(3);
    const resolved = resolveMatrixColumns(all, ["met_1", "met_from_another_alliance"]);
    expect(resolved.map((c) => c.id)).toEqual(["met_1"]);
  });

  it("caps a request exceeding MATRIX_MAX_COLUMNS at the cap, keeping the candidates' own order", () => {
    const all = candidates(9);
    const resolved = resolveMatrixColumns(
      all,
      all.map((c) => c.id),
    );
    expect(resolved).toHaveLength(MATRIX_MAX_COLUMNS);
    expect(resolved.map((c) => c.id)).toEqual(["met_1", "met_2", "met_3", "met_4", "met_5", "met_6"]);
  });

  it("falls back to the default selection when every requested ID is invalid", () => {
    const all = candidates(3);
    const resolved = resolveMatrixColumns(all, ["not-a-real-metric"]);
    expect(resolved).toEqual(all);
  });
});

describe("normalizeMatrixSort", () => {
  const selected = [
    candidate({ id: "met_active", attachmentStatus: "ACTIVE" }),
    candidate({ id: "met_inactive", attachmentStatus: "INACTIVE" }),
    candidate({ id: "met_not_attached", attachmentStatus: "NOT_ATTACHED" }),
  ];

  it("defaults to name ascending when nothing is requested", () => {
    expect(normalizeMatrixSort(undefined, undefined, selected)).toEqual({ kind: "name", direction: "asc" });
  });

  it("defaults direction to ascending for any unrecognized direction value", () => {
    expect(normalizeMatrixSort("name", "sideways", selected)).toEqual({ kind: "name", direction: "asc" });
  });

  it("accepts an explicit name sort in either direction", () => {
    expect(normalizeMatrixSort("name", "desc", selected)).toEqual({ kind: "name", direction: "desc" });
  });

  it("accepts a currently-selected, ACTIVE-attachment metric as the sort key", () => {
    expect(normalizeMatrixSort("met_active", "desc", selected)).toEqual({
      kind: "metric",
      metricId: "met_active",
      direction: "desc",
    });
  });

  it("falls back to name when the requested metric isn't currently selected", () => {
    expect(normalizeMatrixSort("met_not_currently_selected", "asc", selected)).toEqual({
      kind: "name",
      direction: "asc",
    });
  });

  it("falls back to name when the requested column is NOT_ATTACHED — no possible values to sort by", () => {
    expect(normalizeMatrixSort("met_not_attached", "asc", selected)).toEqual({ kind: "name", direction: "asc" });
  });

  it("falls back to name when the requested column is INACTIVE — frozen historical data is excluded from sorting by decision", () => {
    expect(normalizeMatrixSort("met_inactive", "asc", selected)).toEqual({ kind: "name", direction: "asc" });
  });
});

describe("buildCell", () => {
  it("reports NOT_ATTACHED uniformly for every row of a not-attached column, ignoring any raw value", () => {
    const column = candidate({ attachmentStatus: "NOT_ATTACHED" });
    expect(buildCell(column, null)).toEqual({ metricId: column.id, status: "NOT_ATTACHED", value: null });
  });

  it("reports MISSING when no entry exists for an ACTIVE column", () => {
    const column = candidate({ attachmentStatus: "ACTIVE" });
    expect(buildCell(column, null)).toEqual({ metricId: column.id, status: "MISSING", value: null });
  });

  it("reports MISSING when no entry exists for an INACTIVE column (frozen, but still an honest missing state)", () => {
    const column = candidate({ attachmentStatus: "INACTIVE" });
    expect(buildCell(column, null)).toEqual({ metricId: column.id, status: "MISSING", value: null });
  });

  it("reports VALUE for a numeric metric with any recorded value, including negative or zero", () => {
    const column = candidate({ type: Metric_Type.NUMERIC });
    expect(buildCell(column, 42)).toEqual({ metricId: column.id, status: "VALUE", value: 42 });
    expect(buildCell(column, 0)).toEqual({ metricId: column.id, status: "VALUE", value: 0 });
    expect(buildCell(column, -5)).toEqual({ metricId: column.id, status: "VALUE", value: -5 });
  });

  it("reports VALUE for a boolean metric with 0 or 1", () => {
    const column = candidate({ type: Metric_Type.BOOLEAN });
    expect(buildCell(column, 1)).toEqual({ metricId: column.id, status: "VALUE", value: 1 });
    expect(buildCell(column, 0)).toEqual({ metricId: column.id, status: "VALUE", value: 0 });
  });

  it("reports INVALID for a boolean metric with an out-of-range legacy value, carrying the raw value", () => {
    const column = candidate({ type: Metric_Type.BOOLEAN });
    expect(buildCell(column, 5)).toEqual({ metricId: column.id, status: "INVALID", value: 5 });
  });

  it("still reports VALUE for a numeric metric even on a currently-INACTIVE column, preserving inactive history honestly", () => {
    const column = candidate({ type: Metric_Type.NUMERIC, attachmentStatus: "INACTIVE" });
    expect(buildCell(column, 100)).toEqual({ metricId: column.id, status: "VALUE", value: 100 });
  });
});
