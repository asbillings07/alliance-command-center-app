/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const refresh = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh }),
}));

vi.mock("./action", () => ({
  archiveMetric: vi.fn(),
  restoreMetric: vi.fn(),
}));

vi.mock("./metricForm", () => ({
  MetricForm: ({
    onSuccess,
  }: {
    onSuccess?: () => void;
  }) =>
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "mock-create-success",
        onClick: () => onSuccess?.(),
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

import { MetricCard } from "./metricCard";

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

async function mount(props: {
  returnTo?: string;
  targetPeriodId?: string | null;
}) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(MetricCard, {
        allianceId: "all_1",
        mode: "create",
        ...props,
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

describe("MetricCard create flow", () => {
  it("guides to period detail when created without returnTo and a target period exists", async () => {
    await mount({ targetPeriodId: "per_1" });

    await click('button[type="button"]');
    await click('[data-testid="mock-create-success"]');

    expect(container.textContent).toContain(
      "Attach it to an evaluation period to start recording results.",
    );
    expect(container.innerHTML).toContain(
      'href="/alliances/all_1/periods/per_1"',
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("guides to periods list when created without returnTo and no target period", async () => {
    await mount({ targetPeriodId: null });

    await click('button[type="button"]');
    await click('[data-testid="mock-create-success"]');

    expect(container.textContent).toContain(
      "Create an evaluation period first, then attach this metric to it.",
    );
    expect(container.innerHTML).toContain('href="/alliances/all_1/periods"');
  });

  it("keeps returnTo continuation when provided", async () => {
    await mount({
      returnTo: "/alliances/all_1/periods/per_1",
      targetPeriodId: "per_1",
    });

    await click('button[type="button"]');
    await click('[data-testid="mock-create-success"]');

    expect(container.textContent).toContain("Continue configuring this period");
    expect(container.innerHTML).toContain(
      'href="/alliances/all_1/periods/per_1"',
    );
  });
});

describe("MetricCard view mode — FEATURE_REPORTS gate (#190)", () => {
  const metric = {
    id: "met_1",
    name: "VS Points",
    description: null,
    type: "NUMERIC" as const,
    summaryKind: "SUM" as const,
    unitLabel: null,
    trendDirection: "NEUTRAL" as const,
    active: true,
    metricKey: "met_1-1",
  };

  async function mountView(showReportLink?: boolean) {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(
        createElement(MetricCard, {
          allianceId: "all_1",
          mode: "view",
          metric,
          showReportLink,
        }),
      );
    });
  }

  it("hides the View Report link when the flag-derived prop is false (or omitted)", async () => {
    await mountView(false);
    expect(container.textContent).not.toContain("View Report");
  });

  it("shows the View Report link when the server parent resolves the flag as enabled", async () => {
    await mountView(true);
    expect(container.textContent).toContain("View Report");
    expect(container.innerHTML).toContain(
      'href="/alliances/all_1/reports/metrics/met_1"',
    );
  });
});
