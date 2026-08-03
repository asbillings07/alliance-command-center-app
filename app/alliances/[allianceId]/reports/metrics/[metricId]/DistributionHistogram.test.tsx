/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AverageVisualModel, NoneVisualModel } from "@/app/src/lib/reports/metricVisualModel";
import { AverageDistributionChart, NoneNumericDistributionChart } from "./DistributionHistogram";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(element: ReturnType<typeof createElement>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(element);
  });
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function averageModel(overrides: Partial<AverageVisualModel> = {}): AverageVisualModel {
  return {
    kind: "AVERAGE",
    average: 7.4,
    bins: [
      { rangeStart: 0, rangeEnd: 10, count: 2 },
      { rangeStart: 10, rangeEnd: 20, count: 5 },
      { rangeStart: 20, rangeEnd: 30, count: 0 },
      { rangeStart: 30, rangeEnd: 40, count: 3 },
      { rangeStart: 40, rangeEnd: 50, count: 1 },
      { rangeStart: 50, rangeEnd: 60, count: 4 },
    ],
    aboveAverageCount: 0,
    belowAverageCount: 0,
    atAverageCount: 0,
    validCount: 15,
    ...overrides,
  };
}

describe("AverageDistributionChart", () => {
  it("renders six bins with a member count per bin, min/max axis labels, and half-open range labels except the last bin", async () => {
    await mount(createElement(AverageDistributionChart, { visualModel: averageModel(), unitLabel: "pts" }));

    const bins = container.querySelectorAll("[data-testid^='average-histogram-bin-']");
    expect(bins).toHaveLength(6);
    expect(container.textContent).toContain("0 pts ≤ value < 10 pts");
    expect(container.textContent).toContain("50 pts ≤ value ≤ 60 pts"); // last bin: ≤ on both ends
    // min/max axis labels
    expect(container.textContent).toContain("0 pts");
    expect(container.textContent).toContain("60 pts");
  });

  it("renders an empty (zero-count) bin without breaking the rest of the histogram", async () => {
    await mount(createElement(AverageDistributionChart, { visualModel: averageModel(), unitLabel: "pts" }));

    const emptyBin = container.querySelector("[data-testid='average-histogram-bin-2']");
    expect(emptyBin).not.toBeNull();
    const rect = emptyBin!.querySelector("rect");
    expect(rect!.getAttribute("height")).toBe("0");
    expect(emptyBin!.querySelector("text")!.textContent).toBe("0");
  });

  it("draws a vertical average marker whose position is computed across the full min-max domain", async () => {
    await mount(createElement(AverageDistributionChart, { visualModel: averageModel({ average: 30 }), unitLabel: "pts" }));

    const marker = container.querySelector("[data-testid='average-histogram-average-marker']");
    expect(marker).not.toBeNull();
    // domain is [0, 60]; average 30 is the exact midpoint of the plot area.
    const line = marker!.querySelector("line")!;
    expect(Number(line.getAttribute("x1"))).toBeGreaterThan(150);
    expect(Number(line.getAttribute("x1"))).toBeLessThan(170);
    expect(marker!.textContent).toContain("Average: 30 pts");
  });

  it("positions the marker correctly when the average falls exactly on a bin boundary", async () => {
    // Average === bins[2].rangeEnd === bins[3].rangeStart (20).
    await mount(createElement(AverageDistributionChart, { visualModel: averageModel({ average: 20 }), unitLabel: "pts" }));

    const marker = container.querySelector("[data-testid='average-histogram-average-marker']");
    expect(marker).not.toBeNull();
    expect(marker!.textContent).toContain("Average: 20 pts");
  });

  it("renders one centered bar (no separate average marker) for the all-equal one-bin case", async () => {
    const model = averageModel({
      average: 5,
      bins: [{ rangeStart: 5, rangeEnd: 5, count: 14 }],
      validCount: 14,
    });
    await mount(createElement(AverageDistributionChart, { visualModel: model, unitLabel: "points" }));

    expect(container.querySelector("[data-testid='distribution-all-equal-bar']")).not.toBeNull();
    expect(container.querySelector("[data-testid='average-histogram']")).toBeNull();
    expect(container.querySelector("[data-testid='average-histogram-average-marker']")).toBeNull();
    expect(container.textContent).toContain("All 14 valid results were 5 points.");
  });

  it("uses singular grammar for a single valid result in the all-equal case", async () => {
    const model = averageModel({ average: 5, bins: [{ rangeStart: 5, rangeEnd: 5, count: 1 }], validCount: 1 });
    await mount(createElement(AverageDistributionChart, { visualModel: model, unitLabel: null }));

    expect(container.textContent).toContain("All 1 valid result was 5.");
  });

  it("renders nothing when there are zero valid results", async () => {
    const model = averageModel({ average: null, bins: [], validCount: 0 });
    await mount(createElement(AverageDistributionChart, { visualModel: model, unitLabel: "pts" }));

    expect(container.textContent).toBe("");
  });

  it("uses just enough decimal precision so no two adjacent bin boundaries render as the same number", async () => {
    const model = averageModel({
      average: 0.5,
      bins: [
        { rangeStart: 0, rangeEnd: 1 / 3, count: 1 },
        { rangeStart: 1 / 3, rangeEnd: 2 / 3, count: 2 },
        { rangeStart: 2 / 3, rangeEnd: 1, count: 1 },
        { rangeStart: 1, rangeEnd: 4 / 3, count: 0 },
        { rangeStart: 4 / 3, rangeEnd: 5 / 3, count: 1 },
        { rangeStart: 5 / 3, rangeEnd: 2, count: 1 },
      ],
      validCount: 6,
    });
    await mount(createElement(AverageDistributionChart, { visualModel: model, unitLabel: null }));

    const table = container.querySelector("table")!;
    const ranges = Array.from(table.querySelectorAll("tbody td:first-child")).map((td) => td.textContent);
    expect(new Set(ranges).size).toBe(ranges.length); // every displayed range distinct
  });

  it("includes the average and valid-result count in the chart's caption", async () => {
    await mount(createElement(AverageDistributionChart, { visualModel: averageModel({ average: 7.4, validCount: 15 }), unitLabel: "pts" }));

    expect(container.textContent).toContain("Average 7.4 pts across 15 valid results.");
  });
});

function noneNumericModel(overrides: Partial<Extract<NoneVisualModel, { valueKind: "NUMERIC" }>> = {}): Extract<
  NoneVisualModel,
  { valueKind: "NUMERIC" }
> {
  return {
    kind: "NONE",
    valueKind: "NUMERIC",
    bins: [
      { rangeStart: 0, rangeEnd: 10, count: 3 },
      { rangeStart: 10, rangeEnd: 20, count: 2 },
      { rangeStart: 20, rangeEnd: 30, count: 1 },
      { rangeStart: 30, rangeEnd: 40, count: 4 },
      { rangeStart: 40, rangeEnd: 50, count: 0 },
      { rangeStart: 50, rangeEnd: 60, count: 2 },
    ],
    validCount: 12,
    ...overrides,
  };
}

describe("NoneNumericDistributionChart", () => {
  it("uses the same histogram as AVERAGE but never renders an average marker or a headline average/total/percentage", async () => {
    await mount(createElement(NoneNumericDistributionChart, { visualModel: noneNumericModel(), unitLabel: "pts" }));

    expect(container.querySelectorAll("[data-testid^='none-numeric-histogram-bin-']")).toHaveLength(6);
    expect(container.querySelector("[data-testid='none-numeric-histogram-average-marker']")).toBeNull();
    // The visible chart summary (not the optional per-bin table column) must
    // never headline an average, total, or percentage.
    const summary = container.querySelector("#none-numeric-distribution-summary")!;
    expect(summary.textContent).not.toContain("Average:");
    expect(summary.textContent).not.toContain("%");
  });

  it("visibly retains the 'no alliance-wide rollup' note", async () => {
    await mount(createElement(NoneNumericDistributionChart, { visualModel: noneNumericModel(), unitLabel: "pts" }));

    expect(container.textContent).toContain("No alliance-wide rollup is defined for this metric.");
  });

  it("also states the no-rollup note for the all-equal one-bin case", async () => {
    const model = noneNumericModel({ bins: [{ rangeStart: 5, rangeEnd: 5, count: 14 }], validCount: 14 });
    await mount(createElement(NoneNumericDistributionChart, { visualModel: model, unitLabel: "points" }));

    expect(container.textContent).toContain("No alliance-wide rollup is defined for this metric.");
    expect(container.textContent).toContain("All 14 valid results were 5 points.");
  });

  it("renders nothing when there are zero valid results", async () => {
    const model = noneNumericModel({ bins: [], validCount: 0 });
    await mount(createElement(NoneNumericDistributionChart, { visualModel: model, unitLabel: "pts" }));

    expect(container.textContent).toBe("");
  });
});
