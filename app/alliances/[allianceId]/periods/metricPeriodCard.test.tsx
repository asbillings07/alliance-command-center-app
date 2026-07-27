/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("./action", () => ({
  archiveMetricPeriod: vi.fn(),
  restoreMetricPeriod: vi.fn(),
}));

vi.mock("./metricPeriodForm", () => ({
  MetricPeriodForm: ({
    onSuccess,
  }: {
    onSuccess?: (periodId: string) => void;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "mock-create-success",
        onClick: () => onSuccess?.("period-new"),
      },
      "Mock create success",
    ),
}));

vi.mock("@/app/src/components/client", () => ({
  Button: ({
    href,
    children,
  }: {
    href?: string;
    children: React.ReactNode;
  }) => createElement("a", { href }, children),
}));

import { MetricPeriodCard } from "./metricPeriodCard";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function click(selector: string) {
  await act(async () => {
    container
      .querySelector(selector)
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(MetricPeriodCard, {
        allianceId: "all_1",
        mode: "create",
      }),
    );
  });
}

beforeEach(() => {
  refresh.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("MetricPeriodCard create flow", () => {
  it("shows post-create guidance with configure-metrics link", async () => {
    await mount();

    await click('button[type="button"]');
    await click('[data-testid="mock-create-success"]');

    expect(container.textContent).toContain("Evaluation period created.");
    expect(container.textContent).toContain("Configure metrics for this period");
    expect(container.innerHTML).toContain(
      "/alliances/all_1/metrics?returnTo=%2Falliances%2Fall_1%2Fperiods%2Fperiod-new",
    );
    expect(refresh).toHaveBeenCalled();
  });
});
