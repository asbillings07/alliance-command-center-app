/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MetricPreviewAccordion } from "./MetricPreviewAccordion";
import type { MetricImportPreviewData } from "@/app/src/lib/import/importPreviewHelpers";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function matchedResult(name: string, memberId: string, value: number, sourceRow: number) {
  return {
    rawName: name,
    matchedName: name,
    memberId,
    value,
    rawValue: String(value),
    sourceRow,
    confidence: 1,
    status: "matched" as const,
  };
}

function preview(overrides: Partial<MetricImportPreviewData>): MetricImportPreviewData {
  return {
    columnIndex: 1,
    columnName: "Kill Points",
    displayName: "Kill Points",
    proposedMetricName: "Kill Points",
    disposition: "existing",
    target: { kind: "existing", metricId: "met1" },
    summary: {
      total: 2,
      matched: 2,
      unmatched: 0,
      duplicates: 0,
      results: [matchedResult("Dragon", "m1", 100, 2), matchedResult("Phoenix", "m2", 200, 3)],
    },
    skippedBlankCells: [],
    invalidValueIssues: [],
    missingIdentityIssues: [],
    ...overrides,
  };
}

function metricDetails(columnIndex: number): HTMLDetailsElement {
  const element = container.querySelector(`[data-testid="metric-preview-${columnIndex}"]`);
  expect(element).not.toBeNull();
  return element as HTMLDetailsElement;
}

function summaryFor(columnIndex: number): HTMLElement {
  const element = metricDetails(columnIndex).querySelector("summary");
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

async function renderAccordion(
  previews: MetricImportPreviewData[],
  selectionsByColumn: Record<number, Record<string, number> | undefined> = {},
) {
  await act(async () => {
    root.render(
      createElement(MetricPreviewAccordion, {
        previews,
        selectionsByColumn,
        onDuplicateSelection: () => {},
      }),
    );
  });
}

describe("MetricPreviewAccordion [component]", () => {
  it("defaults clean metric rows collapsed while keeping status visible in the header", async () => {
    await renderAccordion([preview({ columnIndex: 1 })], { 1: { m1: 0, m2: 1 } });

    const details = metricDetails(1);
    expect(details.open).toBe(false);
    expect(details.dataset.metricStatus).toBe("ready");
    expect(summaryFor(1).textContent).toContain("Ready");
    expect(summaryFor(1).textContent).toContain("2 importable");
  });

  it("opens the first metric that needs review and keeps issue badges visible when collapsed", async () => {
    const clean = preview({ columnIndex: 1, displayName: "Hero Power" });
    const needsReview = preview({
      columnIndex: 2,
      columnName: "Mystery Score",
      displayName: "Mystery Score",
      proposedMetricName: "Mystery Score",
      summary: {
        total: 1,
        matched: 0,
        unmatched: 1,
        duplicates: 0,
        results: [
          {
            rawName: "Ghost",
            value: undefined,
            rawValue: "50",
            sourceRow: 2,
            confidence: 0,
            status: "unmatched",
          },
        ],
      },
    });

    await renderAccordion([clean, needsReview], { 1: { m1: 0, m2: 1 }, 2: {} });

    expect(metricDetails(1).open).toBe(false);
    expect(metricDetails(2).open).toBe(true);
    expect(summaryFor(2).textContent).toContain("Needs review");
    expect(summaryFor(2).textContent).toContain("1 unmatched");
    expect(
      Array.from(container.querySelectorAll("details[data-testid^='metric-preview-']")).filter(
        (details) => (details as HTMLDetailsElement).open,
      ),
    ).toHaveLength(1);
  });

  it("supports independent multi-metric navigation without collapsing other rows", async () => {
    const first = preview({ columnIndex: 1, displayName: "Kill Points" });
    const second = preview({
      columnIndex: 2,
      columnName: "Hero Power",
      displayName: "Hero Power",
      proposedMetricName: "Hero Power",
    });

    await renderAccordion([first, second], {
      1: { m1: 0, m2: 1 },
      2: { m1: 0, m2: 1 },
    });

    const firstSummary = summaryFor(1);
    const secondSummary = summaryFor(2);

    await act(async () => {
      firstSummary.click();
    });
    expect(metricDetails(1).open).toBe(true);
    expect(metricDetails(2).open).toBe(false);

    await act(async () => {
      secondSummary.click();
    });
    expect(metricDetails(1).open).toBe(true);
    expect(metricDetails(2).open).toBe(true);
    expect(
      Array.from(container.querySelectorAll("details[data-testid^='metric-preview-']")).filter(
        (details) => (details as HTMLDetailsElement).open,
      ),
    ).toHaveLength(2);
  });

  it("exposes keyboard-focusable summary controls for each metric row", async () => {
    await renderAccordion([preview({ columnIndex: 1 })], { 1: { m1: 0, m2: 1 } });

    const summary = summaryFor(1);
    expect(summary.tagName).toBe("SUMMARY");
    expect(summary.getAttribute("aria-controls")).toBe("metric-preview-panel-1");
    expect(summary.getAttribute("aria-expanded")).toBe("false");
  });
});
