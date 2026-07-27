/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const replace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

import { MembersPeriodSelector } from "./MembersPeriodSelector";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

let container: HTMLDivElement;
let root: Root;

async function mount(props: React.ComponentProps<typeof MembersPeriodSelector>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MembersPeriodSelector, props));
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

describe("MembersPeriodSelector", () => {
  it("shows roster-only label when no period is selected", async () => {
    await mount({
      allianceId: "all_1",
      currentFilter: "active",
      periods: [
        { id: "per_1", name: "Season 7", active: true },
        { id: "per_old", name: "Season 6", active: false },
      ],
    });

    expect(container.textContent).toContain("Viewing:");
    expect(container.textContent).toContain("Roster only");
    expect(container.textContent).toContain("Season 6 (Inactive)");
  });

  it("labels archived periods consistently with member detail selector", async () => {
    await mount({
      allianceId: "all_1",
      currentFilter: "all",
      selectedPeriodId: "per_old",
      periods: [
        { id: "per_1", name: "Season 7", active: true },
        { id: "per_old", name: "Season 6", active: false },
      ],
    });

    expect(container.textContent).toContain("Evaluation results for:");
    expect(container.innerHTML).toContain("Season 6 (Inactive)");
    expect(container.innerHTML).toContain("Season 7 (Active)");
  });

  it("clears periodId while preserving the current filter", async () => {
    await mount({
      allianceId: "all_1",
      currentFilter: "archived",
      selectedPeriodId: "per_1",
      periods: [{ id: "per_1", name: "Season 7", active: true }],
    });

    await act(async () => {
      const select = container.querySelector("select") as HTMLSelectElement;
      select.value = "";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(replace).toHaveBeenCalledWith("/alliances/all_1/members?filter=archived");
  });
});
