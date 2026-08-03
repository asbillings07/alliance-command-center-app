/** @vitest-environment jsdom */
import { describe, it, expect, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ChartSection } from "./ChartSection";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ChartSection, {
        titleId: "t1",
        title: "My Chart",
        summaryId: "s1",
        summary: "A visible one-sentence summary.",
        dataDisclosureLabel: "Chart data — 3 rows",
        testId: "my-chart",
        visual: createElement("button", { type: "button", "data-testid": "decoy-button" }, "Should not be interactive"),
        table: createElement("table", null, createElement("tbody", null, createElement("tr", null, createElement("td", null, "row")))),
      }),
    );
  });
}

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("ChartSection", () => {
  it("labels the section via aria-labelledby pointing at the heading's own id", async () => {
    await mount();

    const section = container.querySelector("section")!;
    const heading = container.querySelector("h2")!;
    expect(section.getAttribute("aria-labelledby")).toBe("t1");
    expect(heading.id).toBe("t1");
    expect(heading.textContent).toBe("My Chart");
  });

  it("marks the graphic wrapper aria-hidden, regardless of what's inside it", async () => {
    await mount();

    const graphicWrapper = container.querySelector("[aria-hidden='true']");
    expect(graphicWrapper).not.toBeNull();
    expect(graphicWrapper!.querySelector("[data-testid='decoy-button']")).not.toBeNull();
  });

  it("renders the data table inside an open <details> disclosure by default", async () => {
    await mount();

    const details = container.querySelector("details")!;
    expect(details.hasAttribute("open")).toBe(true);
    expect(details.querySelector("summary")!.textContent).toBe("Chart data — 3 rows");
    expect(details.querySelector("table")).not.toBeNull();
  });

  it("renders the visible summary text outside the aria-hidden graphic", async () => {
    await mount();

    const summary = container.querySelector("#s1")!;
    expect(summary.closest("[aria-hidden='true']")).toBeNull();
    expect(summary.textContent).toBe("A visible one-sentence summary.");
  });
});
