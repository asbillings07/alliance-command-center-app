/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Metric_Type, MetricSummaryKind } from "@/app/generated/prisma/enums";
import type { MetricInfo, MetricCoverage } from "@/app/src/lib/reports/getMetricSummaryReport";
import type { MetricVisualModel } from "@/app/src/lib/reports/metricVisualModel";
import { MetricVisualSection } from "./MetricVisualSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function metric(overrides: Partial<MetricInfo> = {}): MetricInfo {
  return {
    id: "met_1",
    name: "Test Metric",
    type: Metric_Type.NUMERIC,
    summaryKind: MetricSummaryKind.SUM,
    unitLabel: "pts",
    active: true,
    trendDirection: "HIGHER_IS_BETTER",
    ...overrides,
  };
}

function coverage(overrides: Partial<MetricCoverage> = {}): MetricCoverage {
  return {
    currentActiveMemberCount: 10,
    recordedActiveMemberCount: 8,
    invalidActiveMemberCount: 0,
    missingActiveMemberCount: 2,
    complete: false,
    archivedContributingMemberCount: 0,
    ...overrides,
  };
}

async function mount(props: { metric: MetricInfo; visualModel: MetricVisualModel; coverage: MetricCoverage }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MetricVisualSection, props));
  });
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("MetricVisualSection", () => {
  it("dispatches SUM to the contribution chart", async () => {
    await mount({
      metric: metric({ summaryKind: MetricSummaryKind.SUM }),
      visualModel: {
        kind: "SUM",
        shareAvailability: { available: true, percentageOfTotal: 100 },
        topContributors: [
          { allianceMemberId: "m1", playerName: "Alice", archived: false, value: 100, percentageOfTotal: 100 },
        ],
        consideredCount: 1,
      },
      coverage: coverage(),
    });

    expect(container.querySelector("[data-testid='sum-share-chart']")).not.toBeNull();
  });

  it("dispatches AVERAGE to the distribution histogram", async () => {
    await mount({
      metric: metric({ summaryKind: MetricSummaryKind.AVERAGE }),
      visualModel: {
        kind: "AVERAGE",
        average: 5,
        bins: [
          { rangeStart: 0, rangeEnd: 10, count: 3 },
          { rangeStart: 10, rangeEnd: 20, count: 2 },
        ],
        aboveAverageCount: 0,
        belowAverageCount: 0,
        atAverageCount: 0,
        validCount: 5,
      },
      coverage: coverage(),
    });

    expect(container.querySelector("[data-testid='average-distribution-chart']")).not.toBeNull();
  });

  it("dispatches TRUE_RATE to the categorical breakdown", async () => {
    await mount({
      metric: metric({ summaryKind: MetricSummaryKind.TRUE_RATE, type: Metric_Type.BOOLEAN, unitLabel: null }),
      visualModel: {
        kind: "TRUE_RATE",
        trueCount: 5,
        falseCount: 2,
        invalidCount: 0,
        recordedActiveMemberCount: 7,
        missingActiveMemberCount: 1,
        currentActiveMemberCount: 8,
      },
      coverage: coverage(),
    });

    expect(container.querySelector("[data-testid='true-rate-breakdown-chart']")).not.toBeNull();
  });

  it("dispatches NONE+NUMERIC to the distribution histogram without a rollup", async () => {
    await mount({
      metric: metric({ summaryKind: MetricSummaryKind.NONE, unitLabel: null }),
      visualModel: {
        kind: "NONE",
        valueKind: "NUMERIC",
        bins: [
          { rangeStart: 0, rangeEnd: 10, count: 3 },
          { rangeStart: 10, rangeEnd: 20, count: 2 },
        ],
        validCount: 5,
      },
      coverage: coverage(),
    });

    expect(container.querySelector("[data-testid='none-numeric-distribution-chart']")).not.toBeNull();
  });

  it("dispatches NONE+BOOLEAN to the categorical breakdown without a rollup", async () => {
    await mount({
      metric: metric({ summaryKind: MetricSummaryKind.NONE, type: Metric_Type.BOOLEAN, unitLabel: null }),
      visualModel: {
        kind: "NONE",
        valueKind: "BOOLEAN",
        trueCount: 5,
        falseCount: 2,
        invalidCount: 0,
        recordedActiveMemberCount: 7,
        missingActiveMemberCount: 1,
        currentActiveMemberCount: 8,
      },
      coverage: coverage(),
    });

    expect(container.querySelector("[data-testid='none-boolean-breakdown-chart']")).not.toBeNull();
  });

  it("renders no card shell at all when the underlying chart has nothing to draw", async () => {
    await mount({
      metric: metric({ summaryKind: MetricSummaryKind.SUM }),
      visualModel: { kind: "SUM", shareAvailability: { available: true, percentageOfTotal: 100 }, topContributors: [], consideredCount: 0 },
      coverage: coverage(),
    });

    expect(container.querySelector("[data-testid='metric-visual-section']")).toBeNull();
    expect(container.textContent).toBe("");
  });
});
