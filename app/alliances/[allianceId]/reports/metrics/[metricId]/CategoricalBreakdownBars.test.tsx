/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TrueRateVisualModel, NoneVisualModel } from "@/app/src/lib/reports/metricVisualModel";
import type { MetricCoverage } from "@/app/src/lib/reports/getMetricSummaryReport";
import { TrueRateBreakdownChart, NoneBooleanBreakdownChart } from "./CategoricalBreakdownBars";

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

function trueRateModel(overrides: Partial<TrueRateVisualModel> = {}): TrueRateVisualModel {
  return {
    kind: "TRUE_RATE",
    trueCount: 6,
    falseCount: 2,
    invalidCount: 1,
    recordedActiveMemberCount: 8,
    missingActiveMemberCount: 2,
    currentActiveMemberCount: 10,
    ...overrides,
  };
}

describe("TrueRateBreakdownChart", () => {
  it("renders two separately labeled bars: recorded response distribution and active-roster coverage", async () => {
    await mount(createElement(TrueRateBreakdownChart, { visualModel: trueRateModel(), coverage: coverage() }));

    expect(container.textContent).toContain("Recorded response distribution");
    expect(container.textContent).toContain("Active-roster coverage");
    expect(container.querySelector("[data-testid='true-rate-response-bar']")).not.toBeNull();
    expect(container.querySelector("[data-testid='true-rate-coverage-bar']")).not.toBeNull();
  });

  it("states the yes/no/invalid counts and the rate as Yes divided by valid Yes+No", async () => {
    await mount(createElement(TrueRateBreakdownChart, { visualModel: trueRateModel(), coverage: coverage() }));

    expect(container.textContent).toContain("Yes: 6");
    expect(container.textContent).toContain("No: 2");
    expect(container.textContent).toContain("Invalid: 1");
    // 6 / (6+2) = 75%
    expect(container.textContent).toContain("75% Yes, of 8 valid responses.");
  });

  it("uses coverage's active-only valid/invalid/missing counts for the active-roster coverage bar, distinct from recorded totals", async () => {
    await mount(
      createElement(TrueRateBreakdownChart, {
        visualModel: trueRateModel(),
        coverage: coverage({ recordedActiveMemberCount: 5, invalidActiveMemberCount: 1, missingActiveMemberCount: 4, currentActiveMemberCount: 10 }),
      }),
    );

    expect(container.textContent).toContain("Valid recorded: 5");
    expect(container.textContent).toContain("Missing: 4");
  });

  it("notes that recorded response totals include archived contributors, unlike active-roster coverage", async () => {
    await mount(
      createElement(TrueRateBreakdownChart, { visualModel: trueRateModel(), coverage: coverage({ archivedContributingMemberCount: 3 }) }),
    );

    expect(container.textContent).toContain("Recorded response totals include 3 archived contributors; active-roster coverage does not.");
  });

  it("does not show the archived note when there are no archived contributors", async () => {
    await mount(createElement(TrueRateBreakdownChart, { visualModel: trueRateModel(), coverage: coverage({ archivedContributingMemberCount: 0 }) }));

    expect(container.textContent).not.toContain("archived contributor");
  });

  it("handles invalid and missing data with no valid Yes/No responses at all", async () => {
    await mount(
      createElement(TrueRateBreakdownChart, {
        visualModel: trueRateModel({ trueCount: 0, falseCount: 0, invalidCount: 3 }),
        coverage: coverage({ recordedActiveMemberCount: 0, invalidActiveMemberCount: 3, missingActiveMemberCount: 7 }),
      }),
    );

    expect(container.textContent).toContain("No valid Yes/No responses recorded yet.");
    expect(container.textContent).toContain("Invalid: 3");
  });

  it("lists a share of valid responses column in the recorded-response table", async () => {
    await mount(createElement(TrueRateBreakdownChart, { visualModel: trueRateModel(), coverage: coverage() }));

    const tables = container.querySelectorAll("table");
    const headers = Array.from(tables[0]!.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toEqual(["Response", "Count", "Share of valid responses"]);
  });

  it("renders nothing when there is no recorded data and no active roster at all", async () => {
    await mount(
      createElement(TrueRateBreakdownChart, {
        visualModel: trueRateModel({ trueCount: 0, falseCount: 0, invalidCount: 0 }),
        coverage: coverage({ recordedActiveMemberCount: 0, missingActiveMemberCount: 0, currentActiveMemberCount: 0 }),
      }),
    );

    expect(container.textContent).toBe("");
  });
});

function noneBooleanModel(overrides: Partial<Extract<NoneVisualModel, { valueKind: "BOOLEAN" }>> = {}): Extract<
  NoneVisualModel,
  { valueKind: "BOOLEAN" }
> {
  return {
    kind: "NONE",
    valueKind: "BOOLEAN",
    trueCount: 4,
    falseCount: 3,
    invalidCount: 1,
    recordedActiveMemberCount: 7,
    missingActiveMemberCount: 1,
    currentActiveMemberCount: 8,
    ...overrides,
  };
}

describe("NoneBooleanBreakdownChart", () => {
  it("renders the same categorical bars as TRUE_RATE, without a rate headline", async () => {
    await mount(createElement(NoneBooleanBreakdownChart, { visualModel: noneBooleanModel(), coverage: coverage() }));

    expect(container.querySelector("[data-testid='none-boolean-response-bar']")).not.toBeNull();
    expect(container.querySelector("[data-testid='none-boolean-coverage-bar']")).not.toBeNull();
    expect(container.textContent).not.toMatch(/\d+% Yes/);
  });

  it("explicitly states no alliance-wide rollup is defined", async () => {
    await mount(createElement(NoneBooleanBreakdownChart, { visualModel: noneBooleanModel(), coverage: coverage() }));

    expect(container.textContent).toContain("No alliance-wide rollup is defined for this metric.");
  });

  it("omits the 'share of valid responses' column entirely", async () => {
    await mount(createElement(NoneBooleanBreakdownChart, { visualModel: noneBooleanModel(), coverage: coverage() }));

    const tables = container.querySelectorAll("table");
    const headers = Array.from(tables[0]!.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toEqual(["Response", "Count"]);
  });
});
