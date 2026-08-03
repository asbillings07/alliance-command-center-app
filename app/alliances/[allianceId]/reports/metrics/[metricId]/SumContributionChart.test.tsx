/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SumVisualModel, SumTopContributor } from "@/app/src/lib/reports/metricVisualModel";
import { SumContributionChart } from "./SumContributionChart";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function contributor(overrides: Partial<SumTopContributor> = {}): SumTopContributor {
  return {
    allianceMemberId: "m1",
    playerName: "Alice",
    archived: false,
    value: 100,
    percentageOfTotal: null,
    ...overrides,
  };
}

async function mount(visualModel: SumVisualModel, unitLabel: string | null = "pts") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(SumContributionChart, { visualModel, unitLabel }));
  });
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

function barWidth(el: Element | null): string {
  return (el as HTMLElement | null)?.style.width ?? "";
}

describe("SumContributionChart — share mode", () => {
  it("renders one row per topContributor, in model order, with rank/value/percentage and a proportional bar width", async () => {
    const model: SumVisualModel = {
      kind: "SUM",
      shareAvailability: { available: true, percentageOfTotal: 100 },
      topContributors: [
        contributor({ allianceMemberId: "m1", playerName: "Alice", value: 300, percentageOfTotal: 75 }),
        contributor({ allianceMemberId: "m2", playerName: "Bob", value: 100, percentageOfTotal: 25 }),
      ],
      consideredCount: 2,
    };
    await mount(model);

    const rows = container.querySelectorAll("[data-testid^='sum-share-row-']");
    expect(rows).toHaveLength(2);
    expect(rows[0]!.getAttribute("data-testid")).toBe("sum-share-row-m1");
    expect(rows[1]!.getAttribute("data-testid")).toBe("sum-share-row-m2");
    expect(container.textContent).toContain("#1");
    expect(container.textContent).toContain("Alice");
    expect(container.textContent).toContain("75%");
    expect(container.textContent).toContain("#2");
    expect(container.textContent).toContain("Bob");
    expect(container.textContent).toContain("25%");

    const bars = container.querySelectorAll("[data-testid^='sum-share-row-'] .bg-primary");
    expect(barWidth(bars[0]!)).toBe("75%");
    expect(barWidth(bars[1]!)).toBe("25%");
  });

  it("states the caption as 'Top N of M recorded contributors' plus the displayed total share", async () => {
    const model: SumVisualModel = {
      kind: "SUM",
      shareAvailability: { available: true, percentageOfTotal: 100 },
      topContributors: [contributor({ percentageOfTotal: 62 })],
      consideredCount: 18,
    };
    await mount(model);

    expect(container.textContent).toContain("Top 1 of 18 recorded contributors, accounting for 62% of the total.");
  });

  it("shows a visible, screen-reader-readable 'Archived' badge beside an archived contributor's name", async () => {
    const model: SumVisualModel = {
      kind: "SUM",
      shareAvailability: { available: true, percentageOfTotal: 100 },
      topContributors: [contributor({ archived: true, playerName: "Zed", percentageOfTotal: 100 })],
      consideredCount: 1,
    };
    await mount(model);

    expect(container.textContent).toContain("Archived");
  });

  it("retains a zero-value contributor's row with a 0% label and no visible bar fill", async () => {
    const model: SumVisualModel = {
      kind: "SUM",
      shareAvailability: { available: true, percentageOfTotal: 100 },
      topContributors: [
        contributor({ allianceMemberId: "m1", value: 100, percentageOfTotal: 100 }),
        contributor({ allianceMemberId: "m2", playerName: "Zero Contributor", value: 0, percentageOfTotal: 0 }),
      ],
      consideredCount: 2,
    };
    await mount(model);

    const zeroRow = container.querySelector("[data-testid='sum-share-row-m2']");
    expect(zeroRow).not.toBeNull();
    expect(zeroRow!.textContent).toContain("Zero Contributor");
    expect(zeroRow!.textContent).toContain("0%");
    // No fill element rendered at all for a zero share, per the spec.
    expect(zeroRow!.querySelector(".bg-primary")).toBeNull();
  });

  it("does not truncate or drop a long member name", async () => {
    const longName = "A Very Long Alliance Member Display Name That Keeps Going On And On";
    const model: SumVisualModel = {
      kind: "SUM",
      shareAvailability: { available: true, percentageOfTotal: 100 },
      topContributors: [contributor({ playerName: longName, percentageOfTotal: 100 })],
      consideredCount: 1,
    };
    await mount(model);

    expect(container.textContent).toContain(longName);
  });

  it("renders nothing when there are no contributors", async () => {
    const model: SumVisualModel = {
      kind: "SUM",
      shareAvailability: { available: true, percentageOfTotal: 100 },
      topContributors: [],
      consideredCount: 0,
    };
    await mount(model);

    expect(container.textContent).toBe("");
  });
});

describe("SumContributionChart — diverging mode, mixed sign", () => {
  const model: SumVisualModel = {
    kind: "SUM",
    shareAvailability: { available: false, reason: "NEGATIVE_VALUES_PRESENT" },
    topContributors: [
      contributor({ allianceMemberId: "m1", playerName: "Member A", value: 100 }),
      contributor({ allianceMemberId: "m2", playerName: "Member B", value: 50 }),
      contributor({ allianceMemberId: "m3", playerName: "Member C", value: -35 }),
      contributor({ allianceMemberId: "m4", playerName: "Member D", value: -120 }),
    ],
    consideredCount: 18,
  };

  it("never shows percentages, and labels every row with an explicit signed value", async () => {
    await mount(model);

    expect(container.textContent).not.toContain("%");
    expect(container.textContent).toContain("+100 pts");
    expect(container.textContent).toContain("+50 pts");
    expect(container.textContent).toContain("-35 pts");
    expect(container.textContent).toContain("-120 pts");
  });

  it("uses neutral 'Adds to total' / 'Subtracts from total' wording, never 'good'/'bad'", async () => {
    await mount(model);

    expect(container.textContent).toContain("Adds to total");
    expect(container.textContent).toContain("Subtracts from total");
    expect(container.textContent).not.toMatch(/\bgood\b|\bbad\b/i);
  });

  it("produces equal bar lengths for equal magnitudes on opposite sides of the zero baseline", async () => {
    const equalMagnitudeModel: SumVisualModel = {
      ...model,
      topContributors: [
        contributor({ allianceMemberId: "m1", playerName: "Positive Fifty", value: 50 }),
        contributor({ allianceMemberId: "m2", playerName: "Negative Fifty", value: -50 }),
      ],
    };
    await mount(equalMagnitudeModel);

    const positiveBar = container.querySelector("[data-testid='sum-diverging-row-m1'] .bg-primary");
    const negativeBar = container.querySelector("[data-testid='sum-diverging-row-m2'] .bg-warning");
    expect(barWidth(positiveBar)).toBe("100%");
    expect(barWidth(negativeBar)).toBe("100%");
  });

  it("preserves the model's supplied ordering rather than resorting", async () => {
    await mount(model);

    const rows = Array.from(container.querySelectorAll("[data-testid^='sum-diverging-row-']"));
    expect(rows.map((r) => r.getAttribute("data-testid"))).toEqual([
      "sum-diverging-row-m1",
      "sum-diverging-row-m2",
      "sum-diverging-row-m3",
      "sum-diverging-row-m4",
    ]);
  });

  it("lists Member/Direction/Value in the accessible table, with the share-unavailable reason in its caption", async () => {
    await mount(model);

    const table = container.querySelector("table");
    expect(table).not.toBeNull();
    const headers = Array.from(table!.querySelectorAll("th")).map((th) => th.textContent);
    expect(headers).toEqual(["Member", "Direction", "Value"]);
    expect(table!.querySelector("caption")!.textContent).toContain("Member shares are unavailable");
  });
});

describe("SumContributionChart — diverging mode, all-negative", () => {
  const model: SumVisualModel = {
    kind: "SUM",
    shareAvailability: { available: false, reason: "NEGATIVE_VALUES_PRESENT" },
    topContributors: [
      contributor({ allianceMemberId: "m1", playerName: "Member C", value: -35 }),
      contributor({ allianceMemberId: "m2", playerName: "Member D", value: -120 }),
    ],
    consideredCount: 2,
  };

  it("shows the exact non-positive caption and never describes the cohort as mixed", async () => {
    await mount(model);

    expect(container.textContent).toContain("All recorded contributions were non-positive; member shares are unavailable.");
    expect(container.textContent).not.toContain("Adds to total");
  });

  it("puts zero at the right edge and scales every bar to the full plot width from the most-negative selected value", async () => {
    await mount(model);

    const strongestBar = container.querySelector("[data-testid='sum-diverging-row-m2'] .bg-warning");
    const weakerBar = container.querySelector("[data-testid='sum-diverging-row-m1'] .bg-warning");
    expect(barWidth(strongestBar)).toBe("100%"); // -120 is the most negative selected value
    expect(barWidth(weakerBar)).toBe(`${(35 / 120) * 100}%`);
  });
});

describe("SumContributionChart — diverging mode, all-zero", () => {
  const model: SumVisualModel = {
    kind: "SUM",
    shareAvailability: { available: false, reason: "NON_POSITIVE_TOTAL" },
    topContributors: [
      contributor({ allianceMemberId: "m1", playerName: "Member A", value: 0 }),
      contributor({ allianceMemberId: "m2", playerName: "Member B", value: 0 }),
    ],
    consideredCount: 2,
  };

  it("shows a zero-state message instead of an empty diverging plot, but still lists both rows in the table", async () => {
    await mount(model);

    expect(container.querySelector("[data-testid='sum-diverging-zero-state']")).not.toBeNull();
    expect(container.textContent).toContain("All recorded contributions were 0.");
    expect(container.querySelectorAll("[data-testid^='sum-diverging-row-']")).toHaveLength(0);

    const table = container.querySelector("table");
    expect(table!.textContent).toContain("Member A");
    expect(table!.textContent).toContain("Member B");
  });
});
