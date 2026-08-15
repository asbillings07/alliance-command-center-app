/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const replace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

import { MemberComparePeriodSelector } from "./MemberComparePeriodSelector";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(props: React.ComponentProps<typeof MemberComparePeriodSelector>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemberComparePeriodSelector, props));
  });
}

beforeEach(() => {
  replace.mockReset();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

describe("MemberComparePeriodSelector (#349)", () => {
  it("renders nothing when there are no eligible periods to compare against", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_1",
      selectedPeriodId: "per_1",
      chosenComparePeriodId: "no-prior",
      options: [],
    });

    expect(container.innerHTML).toBe("");
  });

  it("renders 'No comparison' plus every eligible period, using the pre-formatted label", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_2",
      selectedPeriodId: "per_20",
      chosenComparePeriodId: "per_19",
      options: [
        { id: "per_19", label: "Week 19 (2026-04-06 – 2026-04-13)" },
        { id: "per_18", label: "Week 18 (2026-03-30 – 2026-04-06)" },
      ],
    });

    expect(container.textContent).toContain("Compare with:");
    expect(container.innerHTML).toContain("No comparison");
    expect(container.innerHTML).toContain("Week 19 (2026-04-06 – 2026-04-13)");
    expect(container.innerHTML).toContain("Week 18 (2026-03-30 – 2026-04-06)");

    const select = container.querySelector("select") as HTMLSelectElement;
    expect(select.value).toBe("per_19");
  });

  it("navigates to the chosen comparison period, preserving the primary periodId", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_2",
      selectedPeriodId: "per_20",
      chosenComparePeriodId: "none",
      options: [{ id: "per_19", label: "Week 19" }],
    });

    await act(async () => {
      const select = container.querySelector("select") as HTMLSelectElement;
      select.value = "per_19";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(replace).toHaveBeenCalledWith(
      "/alliances/all_1/members/mem_2?periodId=per_20&comparePeriodId=per_19",
    );
  });

  it("navigates with the explicit 'none' sentinel when the leader opts out", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_2",
      selectedPeriodId: "per_20",
      chosenComparePeriodId: "per_19",
      options: [{ id: "per_19", label: "Week 19" }],
    });

    await act(async () => {
      const select = container.querySelector("select") as HTMLSelectElement;
      select.value = "none";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(replace).toHaveBeenCalledWith(
      "/alliances/all_1/members/mem_2?periodId=per_20&comparePeriodId=none",
    );
  });
});
