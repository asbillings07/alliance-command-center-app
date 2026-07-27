/** @vitest-environment jsdom */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MetricPreviewAccordion } from "./MetricPreviewAccordion";
import {
  getPreviewEntries,
  type MetricImportPreviewData,
} from "@/app/src/lib/import/importPreviewHelpers";

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

function activeMetricPanel(): HTMLElement {
  const panels = container.querySelectorAll('[data-testid^="metric-preview-"][data-metric-status]');
  expect(panels).toHaveLength(1);
  return panels[0] as HTMLElement;
}

function navigator(): HTMLElement {
  const element = container.querySelector('[data-testid="metric-preview-navigator"]');
  expect(element).not.toBeNull();
  return element as HTMLElement;
}

async function renderAccordion(
  previews: MetricImportPreviewData[],
  selectionsByColumn: Record<number, Record<string, number> | undefined> = {},
  onDuplicateSelection: (columnIndex: number, memberId: string, resultIndex: number) => void = () => {},
  contextLabelForPreview?: (preview: MetricImportPreviewData) => string | undefined,
) {
  await act(async () => {
    root.render(
      createElement(MetricPreviewAccordion, {
        previews,
        selectionsByColumn,
        onDuplicateSelection,
        contextLabelForPreview,
      }),
    );
  });
}

async function renderAccordionWithSelectionState(previews: MetricImportPreviewData[]) {
  const state: { selections: Record<number, Record<string, number> | undefined> } = {
    selections: {},
  };

  function Harness() {
    const [selectionsByColumn, setSelectionsByColumn] = useState<
      Record<number, Record<string, number> | undefined>
    >(() => {
      const initial: Record<number, Record<string, number>> = {};
      for (const item of previews) {
        if (item.summary.duplicates > 0) {
          initial[item.columnIndex] = { m1: 0 };
        } else {
          initial[item.columnIndex] = { m1: 0, m2: 1 };
        }
      }
      state.selections = initial;
      return initial;
    });

    const handleDuplicateSelection = (columnIndex: number, memberId: string, resultIndex: number) => {
      setSelectionsByColumn((prev) => {
        const next = {
          ...prev,
          [columnIndex]: { ...(prev[columnIndex] ?? {}), [memberId]: resultIndex },
        };
        state.selections = next;
        return next;
      });
    };

    return createElement(MetricPreviewAccordion, {
      previews,
      selectionsByColumn,
      onDuplicateSelection: handleDuplicateSelection,
    });
  }

  await act(async () => {
    root.render(createElement(Harness));
  });

  return state;
}

describe("MetricPreviewAccordion [component]", () => {
  it("defaults to the first metric needing review and renders only that metric detail", async () => {
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

    expect(activeMetricPanel().dataset.testid).toBe("metric-preview-2");
    expect(activeMetricPanel().dataset.metricStatus).toBe("needs_review");
    expect(container.querySelector('[data-testid="metric-preview-1"]')).toBeNull();
    expect(navigator().textContent).toContain("Metric 2 of 2");
    expect(navigator().textContent).toContain("1 need review");
  });

  it("renders only one metric row-detail table even with a large preview set", async () => {
    const largeSet = Array.from({ length: 40 }, (_, index) =>
      preview({
        columnIndex: index + 1,
        columnName: `Metric Column ${index + 1}`,
        displayName: `Tracked Metric ${index + 1}`,
        proposedMetricName: `Tracked Metric ${index + 1}`,
      }),
    );

    await renderAccordion(
      largeSet,
      Object.fromEntries(largeSet.map((item) => [item.columnIndex, { m1: 0, m2: 1 }])),
    );

    expect(container.querySelectorAll('[data-testid="metric-preview-row-detail"]')).toHaveLength(1);
    expect(container.querySelectorAll('[data-metric-status]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="metric-preview-row-1-0"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="metric-preview-row-2-0"]')).toBeNull();
    expect(container.querySelector('[data-testid="metric-preview-row-40-0"]')).toBeNull();
    expect(activeMetricPanel().textContent).toContain("Tracked Metric 1");
  });

  it("navigates with previous, next, and jump controls to arbitrary metrics", async () => {
    const first = preview({ columnIndex: 1, displayName: "Kill Points" });
    const second = preview({
      columnIndex: 2,
      columnName: "Hero Power",
      displayName: "Hero Power",
      proposedMetricName: "Hero Power",
    });
    const third = preview({
      columnIndex: 3,
      columnName: "Tech Points",
      displayName: "Tech Points",
      proposedMetricName: "Tech Points",
    });

    await renderAccordion([first, second, third], {
      1: { m1: 0, m2: 1 },
      2: { m1: 0, m2: 1 },
      3: { m1: 0, m2: 1 },
    });

    const nextButton = navigator().querySelector('[data-testid="metric-preview-next"]') as HTMLButtonElement;
    const previousButton = navigator().querySelector('[data-testid="metric-preview-previous"]') as HTMLButtonElement;
    const jumpSelect = navigator().querySelector('[data-testid="metric-preview-jump"]') as HTMLSelectElement;

    expect(previousButton.disabled).toBe(true);

    await act(async () => {
      nextButton.click();
    });
    expect(activeMetricPanel().dataset.testid).toBe("metric-preview-2");

    await act(async () => {
      jumpSelect.value = "2";
      jumpSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(activeMetricPanel().dataset.testid).toBe("metric-preview-3");

    await act(async () => {
      previousButton.click();
    });
    expect(activeMetricPanel().dataset.testid).toBe("metric-preview-2");
  });

  it("filters navigation to metrics needing review", async () => {
    const clean = preview({ columnIndex: 1, displayName: "Hero Power" });
    const needsReview = preview({
      columnIndex: 2,
      displayName: "Mystery Score",
      columnName: "Mystery Score",
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
    const anotherClean = preview({
      columnIndex: 3,
      displayName: "Tech Points",
      columnName: "Tech Points",
      proposedMetricName: "Tech Points",
    });

    await renderAccordion([clean, needsReview, anotherClean], {
      1: { m1: 0, m2: 1 },
      2: {},
      3: { m1: 0, m2: 1 },
    });

    const filterButton = navigator().querySelector(
      '[data-testid="metric-preview-needs-review-filter"]',
    ) as HTMLButtonElement;
    const nextButton = navigator().querySelector('[data-testid="metric-preview-next"]') as HTMLButtonElement;

    await act(async () => {
      filterButton.click();
    });

    expect(navigator().textContent).toContain("Needs review 1 of 1");
    expect(nextButton.disabled).toBe(true);
    expect(activeMetricPanel().dataset.testid).toBe("metric-preview-2");

    const jumpSelect = navigator().querySelector('[data-testid="metric-preview-jump"]') as HTMLSelectElement;
    expect(jumpSelect.options).toHaveLength(1);
    expect(jumpSelect.options[0].textContent).toContain("Mystery Score");
  });

  it("preserves duplicate selections and import payload accuracy after navigation", async () => {
    const duplicateMetric = preview({
      columnIndex: 1,
      displayName: "Kill Points",
      summary: {
        total: 2,
        matched: 1,
        unmatched: 0,
        duplicates: 1,
        results: [
          matchedResult("Dragon", "m1", 100, 2),
          {
            rawName: "Dragon",
            matchedName: "Dragon",
            memberId: "m1",
            value: 250,
            rawValue: "250",
            sourceRow: 3,
            confidence: 1,
            status: "duplicate" as const,
          },
        ],
      },
    });
    const secondMetric = preview({
      columnIndex: 2,
      displayName: "Hero Power",
      columnName: "Hero Power",
      proposedMetricName: "Hero Power",
    });

    const state = await renderAccordionWithSelectionState([duplicateMetric, secondMetric]);

    const useThisButton = Array.from(activeMetricPanel().querySelectorAll("button")).find(
      (button) => button.textContent === "Use This",
    );
    expect(useThisButton).toBeDefined();
    await act(async () => {
      useThisButton!.click();
    });

    const nextButton = navigator().querySelector('[data-testid="metric-preview-next"]') as HTMLButtonElement;
    await act(async () => {
      nextButton.click();
    });
    expect(activeMetricPanel().dataset.testid).toBe("metric-preview-2");

    const previousButton = navigator().querySelector('[data-testid="metric-preview-previous"]') as HTMLButtonElement;
    await act(async () => {
      previousButton.click();
    });
    expect(activeMetricPanel().dataset.testid).toBe("metric-preview-1");
    expect(
      activeMetricPanel().querySelector('[data-testid="metric-preview-row-1-1"] button')?.textContent,
    ).toBe("Selected");

    expect(
      getPreviewEntries(duplicateMetric, state.selections[1]).map((entry) => entry.rawValue),
    ).toEqual(["250"]);
    expect(getPreviewEntries(secondMetric, state.selections[2])).toHaveLength(2);

    const totalEntries =
      getPreviewEntries(duplicateMetric, state.selections[1]).length +
      getPreviewEntries(secondMetric, state.selections[2]).length;
    expect(totalEntries).toBe(3);
  });

  it("includes period context in the navigator for multi-period previews", async () => {
    const first = preview({ columnIndex: 1, displayName: "Kill Points" });
    const second = preview({
      columnIndex: 2,
      displayName: "Hero Power",
      columnName: "Hero Power",
      proposedMetricName: "Hero Power",
    });

    await renderAccordion([first, second], { 1: { m1: 0, m2: 1 }, 2: { m1: 0, m2: 1 } }, () => {}, (item) =>
      item.columnIndex === 1 ? "January 2026" : "February 2026",
    );

    expect(navigator().textContent).toContain("Period: January 2026 — Metric 1 of 2");
  });

  it("exposes accessible navigator controls", async () => {
    await renderAccordion([preview({ columnIndex: 1 })], { 1: { m1: 0, m2: 1 } });

    expect(navigator().querySelector('[data-testid="metric-preview-previous"]')?.getAttribute("aria-label")).toBe(
      "Previous metric",
    );
    expect(navigator().querySelector('[data-testid="metric-preview-next"]')?.getAttribute("aria-label")).toBe(
      "Next metric",
    );
    expect(navigator().querySelector('label[for="metric-preview-jump"]')?.textContent).toBe("Jump to metric");
    expect(container.querySelector('[role="region"][aria-label="Metric import previews"]')).not.toBeNull();
  });
});
