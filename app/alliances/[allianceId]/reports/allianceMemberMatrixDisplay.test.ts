import { describe, it, expect } from "vitest";
import { Metric_Type } from "@/app/generated/prisma/enums";
import type { MatrixCell, MatrixColumnCandidate } from "@/app/src/lib/reports/allianceMemberMatrix";
import { formatMatrixCell, formatMatrixColumnChooserLabel } from "./allianceMemberMatrixDisplay";

function column(overrides: Partial<MatrixColumnCandidate> = {}): MatrixColumnCandidate {
  return {
    id: "met_1",
    name: "Donations",
    type: Metric_Type.NUMERIC,
    unitLabel: "pts",
    attachmentStatus: "ACTIVE",
    ...overrides,
  };
}

describe("formatMatrixCell", () => {
  it("formats a numeric VALUE cell with its unit label and exact tooltip", () => {
    const cell: MatrixCell = { metricId: "met_1", status: "VALUE", value: 1500 };
    const display = formatMatrixCell(cell, column({ unitLabel: "pts" }));
    expect(display.text).toContain("pts");
    expect(display.title).toBe("1,500");
  });

  it("formats a boolean VALUE cell as Yes/No, never the raw 0/1", () => {
    const boolColumn = column({ type: Metric_Type.BOOLEAN, unitLabel: null });
    expect(formatMatrixCell({ metricId: "met_1", status: "VALUE", value: 1 }, boolColumn)).toEqual({ text: "Yes" });
    expect(formatMatrixCell({ metricId: "met_1", status: "VALUE", value: 0 }, boolColumn)).toEqual({ text: "No" });
  });

  it("formats MISSING/INVALID/NOT_ATTACHED cells with their status text, regardless of any carried value", () => {
    expect(formatMatrixCell({ metricId: "met_1", status: "MISSING", value: null }, column())).toEqual({
      text: "Missing",
    });
    expect(formatMatrixCell({ metricId: "met_1", status: "INVALID", value: 7 }, column())).toEqual({
      text: "Invalid",
    });
    expect(formatMatrixCell({ metricId: "met_1", status: "NOT_ATTACHED", value: null }, column())).toEqual({
      text: "Not attached",
    });
  });
});

describe("formatMatrixColumnChooserLabel", () => {
  it("returns the bare metric name for an ACTIVE column", () => {
    expect(formatMatrixColumnChooserLabel(column({ attachmentStatus: "ACTIVE" }))).toBe("Donations");
  });

  it("suffixes a NOT_ATTACHED column so a leader isn't surprised it's empty", () => {
    expect(formatMatrixColumnChooserLabel(column({ attachmentStatus: "NOT_ATTACHED" }))).toBe(
      "Donations (not attached)",
    );
  });

  it("suffixes an INACTIVE column", () => {
    expect(formatMatrixColumnChooserLabel(column({ attachmentStatus: "INACTIVE" }))).toBe("Donations (inactive)");
  });
});
