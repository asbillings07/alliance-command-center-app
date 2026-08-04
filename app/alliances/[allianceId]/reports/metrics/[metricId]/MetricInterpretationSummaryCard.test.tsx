/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MetricInterpretationSummaryCard } from "./MetricInterpretationSummaryCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("MetricInterpretationSummaryCard", () => {
  it("renders the deterministic summary sentence verbatim", async () => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(MetricInterpretationSummaryCard, {
          interpretationSummary: "Contributions totaled 1,240; the top 10 members accounted for 62% of the total.",
        }),
      );
    });

    expect(container.textContent).toContain("What This Tells You");
    expect(container.querySelector("[data-testid='metric-interpretation-summary']")!.textContent).toBe(
      "Contributions totaled 1,240; the top 10 members accounted for 62% of the total.",
    );
  });
});
