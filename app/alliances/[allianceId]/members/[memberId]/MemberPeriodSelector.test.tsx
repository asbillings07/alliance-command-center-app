/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

const replace = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace }),
}));

import { MemberPeriodSelector } from "./MemberPeriodSelector";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function mount(props: React.ComponentProps<typeof MemberPeriodSelector>) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(MemberPeriodSelector, props));
  });
}

function selectPeriod(periodId: string) {
  const select = container.querySelector("select") as HTMLSelectElement;
  select.value = periodId;
  select.dispatchEvent(new Event("change", { bubbles: true }));
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

// Periods are always passed in the same chronological order page.tsx
// queries them in (newest first) - see the component's own doc comment for
// why array position (not re-derived dates) drives the eligibility check
// below.
const PERIODS = [
  { id: "per_20", name: "Week 20", active: true },
  { id: "per_19", name: "Week 19", active: false },
  { id: "per_18", name: "Week 18", active: false },
];

describe("MemberPeriodSelector - validity-aware compare-period reset (#349)", () => {
  it("hides entirely when there is only one period", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_1",
      selectedPeriodId: "per_20",
      periods: [PERIODS[0]!],
      chosenComparePeriodId: "no-prior",
    });

    expect(container.innerHTML).toBe("");
  });

  it("'none' chosen, new primary still has eligible periods -> retains 'none'", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_1",
      selectedPeriodId: "per_19",
      periods: PERIODS,
      chosenComparePeriodId: "none",
    });

    await act(async () => selectPeriod("per_20"));

    expect(replace).toHaveBeenCalledWith(
      "/alliances/all_1/members/mem_1?periodId=per_20&comparePeriodId=none",
    );
  });

  it("'none' chosen, new primary has no eligible periods -> omits the param (server canonicalizes to 'no-prior')", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_1",
      selectedPeriodId: "per_19",
      periods: PERIODS,
      chosenComparePeriodId: "none",
    });

    await act(async () => selectPeriod("per_18"));

    expect(replace).toHaveBeenCalledWith("/alliances/all_1/members/mem_1?periodId=per_18");
  });

  // The plan's transition matrix also lists "'no-prior' chosen, new primary
  // still has no eligible periods -> retains 'no-prior'." That transition
  // is not exercisable here: a single alliance's periods form one strict
  // chronological order (see `metricPeriodChronologicalOrderBy`), so
  // exactly one period can ever have zero older periods at a time. This
  // component's `onChange` only ever fires on an actual `<select>` value
  // change, so there is no way to "switch primary period" while remaining
  // on that one oldest period - the case is structurally unreachable, not
  // merely untested.

  it("'no-prior' chosen, new primary gains eligible periods -> omits the param (server canonicalizes to the new immediate predecessor)", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_1",
      selectedPeriodId: "per_18",
      periods: PERIODS,
      chosenComparePeriodId: "no-prior",
    });

    await act(async () => selectPeriod("per_20"));

    expect(replace).toHaveBeenCalledWith("/alliances/all_1/members/mem_1?periodId=per_20");
  });

  it("an explicit period id chosen, still older than the new primary -> retains it", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_1",
      selectedPeriodId: "per_20",
      periods: PERIODS,
      chosenComparePeriodId: "per_18",
    });

    // per_19 (the new primary) is still newer than per_18, so per_18
    // remains a legal comparison.
    await act(async () => selectPeriod("per_19"));

    expect(replace).toHaveBeenCalledWith(
      "/alliances/all_1/members/mem_1?periodId=per_19&comparePeriodId=per_18",
    );
  });

  it("an explicit period id chosen, no longer older than the new primary -> omits the param (server canonicalizes)", async () => {
    await mount({
      allianceId: "all_1",
      memberId: "mem_1",
      selectedPeriodId: "per_20",
      periods: PERIODS,
      chosenComparePeriodId: "per_19",
    });

    // per_18 (the new primary) is now older than per_19, so per_19 is no
    // longer a legal comparison for it.
    await act(async () => selectPeriod("per_18"));

    expect(replace).toHaveBeenCalledWith("/alliances/all_1/members/mem_1?periodId=per_18");
  });
});
