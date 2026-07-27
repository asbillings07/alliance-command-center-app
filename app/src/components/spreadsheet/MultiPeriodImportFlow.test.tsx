/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  MultiPeriodImportFlow,
  CREATE_PERIOD_SELECT_VALUE,
  UNCONFIRMED_PERIOD_SELECT_VALUE,
  UNCONFIRMED_TARGET_TOKEN,
} from "./MultiPeriodImportFlow";
import {
  buildManualFallbackProposal,
  buildPeriodMappingReview,
  resolveImportProposals,
  UNKNOWN_METRIC_IDENTITY,
  type PeriodMappingReview,
} from "@/app/src/lib/import/periodProposal";
import type { ParsedWorkbook } from "@/app/src/lib/workbookParser";
import type { TableBoundsResult } from "@/app/src/lib/memberMatcher";
import { detectTableBounds, analyzeRows, cellAddress } from "@/app/src/lib/memberMatcher";
import { importMultiPeriodMetrics } from "@/app/alliances/[allianceId]/periods/[periodId]/import/multiPeriodAction";

const importMock = vi.mocked(importMultiPeriodMetrics);

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    refresh: mockRefresh,
  }),
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    createElement("a", { href, ...props }, children),
}));

vi.mock(
  "@/app/alliances/[allianceId]/periods/[periodId]/import/multiPeriodAction",
  () => ({
    importMultiPeriodMetrics: vi.fn(),
  }),
);

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.clearAllMocks();
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

const allianceId = "alliance-1";
const members = [
  { id: "m1", playerName: "Dragon" },
  { id: "m2", playerName: "Phoenix" },
];
const allianceLibraryMetrics = [
  { id: "lib-kills", name: "Kills" },
  { id: "met1", name: "Kill Points" },
];

function buildWorkbookFromRows(rows: string[][]): ParsedWorkbook {
  return {
    fileName: "test.xlsx",
    format: "xlsx",
    date1904: false,
    defaultSheetIndex: 0,
    sheets: [
      {
        name: "March 2026",
        index: 0,
        visibility: "visible",
        rows,
        cellDates: {},
        issues: [],
      },
    ],
  };
}

function buildMultiPeriodReview(): PeriodMappingReview {
  return buildPeriodMappingReview({
    sheetName: "March 2026",
    headerRowIndex: 0,
    headers: [
      {
        columnIndex: 0,
        headerText: "Player",
        headerAddress: "A1",
        isPlayerColumn: true,
      },
      {
        columnIndex: 1,
        headerText: "Kills on 3/29",
        headerAddress: "B1",
        isNumeric: true,
      },
      {
        columnIndex: 2,
        headerText: "Kills on 4/13",
        headerAddress: "C1",
        isNumeric: true,
      },
    ],
  });
}

function buildTableContext(workbook: ParsedWorkbook) {
  const sheet = workbook.sheets[0]!;
  const bounds = detectTableBounds(sheet.rows);
  const analyzed = analyzeRows(sheet.rows, bounds, 0);
  return {
    tableBounds: analyzed.tableBounds ?? bounds,
    playerColumnIndex: analyzed.columns.find((c) => c.name === "Player")?.index ?? 0,
  };
}

async function selectOptionValue(select: HTMLSelectElement, nextValue: string) {
  await act(async () => {
    const nativeSelectValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLSelectElement.prototype,
      "value",
    )?.set;
    nativeSelectValueSetter?.call(select, nextValue);
    select.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
}

async function fillInputElement(input: HTMLInputElement, nextValue: string) {
  await act(async () => {
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    nativeInputValueSetter?.call(input, nextValue);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 10));
  });
}

function renderFlow(props: Partial<React.ComponentProps<typeof MultiPeriodImportFlow>> & {
  review: PeriodMappingReview;
  parsedWorkbook: ParsedWorkbook;
  tableBounds: TableBoundsResult;
  playerColumnIndex: number;
}) {
  const defaults = {
    allianceId,
    routePeriodId: null,
    alliancePeriods: [],
    allianceLibraryMetrics,
    canCreateMetrics: true,
    canAttachMetrics: true,
    canConfigurePeriods: true,
    members,
    selectedSheetIndex: 0,
    onCancel: vi.fn(),
  };
  return act(async () => {
    root.render(createElement(MultiPeriodImportFlow, { ...defaults, ...props }));
    await new Promise((r) => setTimeout(r, 20));
  });
}

describe("MultiPeriodImportFlow [component]", () => {
  it("defaults each proposal to distinct create targets when no alliance periods exist", async () => {
    const workbook = buildWorkbookFromRows([
      ["Player", "Kills on 3/29", "Kills on 4/13"],
      ["Dragon", "1500", "2000"],
    ]);
    const review = buildMultiPeriodReview();
    const { tableBounds, playerColumnIndex } = buildTableContext(workbook);

    await renderFlow({
      review,
      parsedWorkbook: workbook,
      tableBounds,
      playerColumnIndex,
      resolvedProposals: resolveImportProposals(review),
    });

    const nameInputs = Array.from(
      container.querySelectorAll('input[id^="multi-period-target-"][id$="-name"]'),
    ) as HTMLInputElement[];
    expect(nameInputs.length).toBeGreaterThanOrEqual(2);
    const names = nameInputs.map((input) => input.value.trim()).filter(Boolean);
    expect(new Set(names).size).toBe(2);
    expect(names.some((name) => name.includes("Mar 29"))).toBe(true);
    expect(names.some((name) => name.includes("Apr 13"))).toBe(true);
  });

  it("uses proposal-derived create targets on guided setup route when routePeriodId is null", async () => {
    const existingPeriodId = "period-existing";
    const workbook = buildWorkbookFromRows([
      ["Player", "Kills on 3/29", "Kills on 4/13"],
      ["Dragon", "1500", "2000"],
    ]);
    const review = buildMultiPeriodReview();
    const { tableBounds, playerColumnIndex } = buildTableContext(workbook);

    await renderFlow({
      review,
      parsedWorkbook: workbook,
      tableBounds,
      playerColumnIndex,
      routePeriodId: null,
      alliancePeriods: [
        {
          id: existingPeriodId,
          name: "Latest Period",
          startsAt: "2026-03-01T00:00:00.000Z",
          endsAt: null,
          metrics: [],
        },
      ],
      resolvedProposals: resolveImportProposals(review),
    });

    const periodSelects = Array.from(
      container.querySelectorAll('select[id^="multi-period-target-"]'),
    ) as HTMLSelectElement[];
    expect(periodSelects.length).toBeGreaterThanOrEqual(2);
    for (const select of periodSelects) {
      expect(select.value).toBe(CREATE_PERIOD_SELECT_VALUE);
    }
  });

  it("pre-fills suggested existing period but keeps it editable when routePeriodId is set", async () => {
    const existingPeriodId = "period-existing";
    const workbook = buildWorkbookFromRows([
      ["Player", "Kills on 3/29"],
      ["Dragon", "1500"],
    ]);
    const review = buildPeriodMappingReview({
      sheetName: "March 2026",
      headerRowIndex: 0,
      headers: [
        {
          columnIndex: 0,
          headerText: "Player",
          headerAddress: "A1",
          isPlayerColumn: true,
        },
        {
          columnIndex: 1,
          headerText: "Kills on 3/29",
          headerAddress: "B1",
          isNumeric: true,
        },
      ],
    });
    const { tableBounds, playerColumnIndex } = buildTableContext(workbook);

    await renderFlow({
      review,
      parsedWorkbook: workbook,
      tableBounds,
      playerColumnIndex,
      routePeriodId: existingPeriodId,
      alliancePeriods: [
        {
          id: "older-period",
          name: "Older Period",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: null,
          metrics: [],
        },
        {
          id: existingPeriodId,
          name: "Latest Period",
          startsAt: "2026-03-01T00:00:00.000Z",
          endsAt: null,
          metrics: [],
        },
      ],
      resolvedProposals: resolveImportProposals(review),
    });

    const periodSelect = container.querySelector(
      'select[id^="multi-period-target-"]',
    ) as HTMLSelectElement;
    expect(periodSelect.value).toBe(existingPeriodId);

    await selectOptionValue(periodSelect, CREATE_PERIOD_SELECT_VALUE);
    const nameInput = container.querySelector(
      'input[id^="multi-period-target-"][id$="-name"]',
    ) as HTMLInputElement;
    expect(nameInput.value.trim().length).toBeGreaterThan(0);
  });

  it("synthesizes manual_fallback proposal with low confidence and classified columns", () => {
    const review = buildPeriodMappingReview({
      sheetName: "Results",
      headerRowIndex: 0,
      headers: [
        {
          columnIndex: 0,
          headerText: "Player",
          headerAddress: cellAddress(0, 0),
          isPlayerColumn: true,
        },
        {
          columnIndex: 1,
          headerText: "Kill Points",
          headerAddress: cellAddress(0, 1),
          isNumeric: true,
        },
        {
          columnIndex: 2,
          headerText: "% Change",
          headerAddress: cellAddress(0, 2),
          isNumeric: true,
        },
      ],
    });

    expect(review.mode).toBe("insufficient_evidence");
    const resolved = resolveImportProposals(review);
    expect(resolved).toHaveLength(1);
    expect(resolved[0]!.source).toBe("manual_fallback");
    expect(resolved[0]!.confidence).toBe("low");
    expect(resolved[0]!.dateKind).toBe("unspecified");
    expect(resolved[0]!.startsAtISO).toBeNull();
    expect(resolved[0]!.columns.map((c) => c.headerText)).toEqual(["Kill Points"]);
  });

  it("blocks leaders without CONFIGURE_PERIODS before mapping when a new period is required", async () => {
    const workbook = buildWorkbookFromRows([
      ["Player", "Kill Points"],
      ["Dragon", "1500"],
    ]);
    const review = buildPeriodMappingReview({
      sheetName: "Results",
      headerRowIndex: 0,
      headers: [
        {
          columnIndex: 0,
          headerText: "Player",
          headerAddress: "A1",
          isPlayerColumn: true,
        },
        {
          columnIndex: 1,
          headerText: "Kill Points",
          headerAddress: "B1",
          isNumeric: true,
        },
      ],
    });
    const { tableBounds, playerColumnIndex } = buildTableContext(workbook);

    await renderFlow({
      review,
      parsedWorkbook: workbook,
      tableBounds,
      playerColumnIndex,
      canConfigurePeriods: false,
      canCreateMetrics: true,
      canAttachMetrics: false,
      resolvedProposals: resolveImportProposals(review),
    });

    expect(container.textContent).toContain("Evaluation period configuration required");
    expect(container.textContent).toContain("Ask an Admin or Owner");
    expect(container.querySelector('select[aria-label^="Metric for"]')).toBeNull();
  });

  it("allows import-capable roles to map into an existing period without CONFIGURE_PERIODS", async () => {
    const existingPeriodId = "period-existing";
    const workbook = buildWorkbookFromRows([
      ["Player", "Kills on 3/29"],
      ["Dragon", "1500"],
    ]);
    const review = buildPeriodMappingReview({
      sheetName: "March 2026",
      headerRowIndex: 0,
      headers: [
        {
          columnIndex: 0,
          headerText: "Player",
          headerAddress: "A1",
          isPlayerColumn: true,
        },
        {
          columnIndex: 1,
          headerText: "Kills on 3/29",
          headerAddress: "B1",
          isNumeric: true,
        },
      ],
    });
    const { tableBounds, playerColumnIndex } = buildTableContext(workbook);

    await renderFlow({
      review,
      parsedWorkbook: workbook,
      tableBounds,
      playerColumnIndex,
      routePeriodId: existingPeriodId,
      canConfigurePeriods: false,
      canCreateMetrics: false,
      canAttachMetrics: false,
      alliancePeriods: [
        {
          id: existingPeriodId,
          name: "Existing Period",
          startsAt: "2026-03-01T00:00:00.000Z",
          endsAt: null,
          metrics: [{ id: "met1", name: "Kill Points" }],
        },
      ],
      resolvedProposals: resolveImportProposals(review),
    });

    expect(container.textContent).not.toContain("Evaluation period configuration required");
    expect(container.querySelector('select[id^="multi-period-target-"]')).not.toBeNull();
  });

  it("keeps preview disabled for supplemental unassigned columns until period and metrics are explicit", async () => {
    const existingPeriodId = "period-existing";
    const workbook = buildWorkbookFromRows([
      ["Player", "Kills on 3/29", "Kills on 4/13", "Hero Power", "Kills on 3/4"],
      ["Dragon", "1500", "2000", "9000", "300"],
    ]);
    const review = buildPeriodMappingReview({
      sheetName: "March 2026",
      headerRowIndex: 0,
      headers: [
        {
          columnIndex: 0,
          headerText: "Player",
          headerAddress: "A1",
          isPlayerColumn: true,
        },
        {
          columnIndex: 1,
          headerText: "Kills on 3/29",
          headerAddress: "B1",
          isNumeric: true,
        },
        {
          columnIndex: 2,
          headerText: "Kills on 4/13",
          headerAddress: "C1",
          isNumeric: true,
        },
        {
          columnIndex: 3,
          headerText: "Hero Power",
          headerAddress: "D1",
          isNumeric: true,
        },
        {
          columnIndex: 4,
          headerText: "Kills on 3/4",
          headerAddress: "E1",
          isNumeric: true,
        },
      ],
    });
    const { tableBounds, playerColumnIndex } = buildTableContext(workbook);
    const resolved = resolveImportProposals(review);

    await renderFlow({
      review,
      parsedWorkbook: workbook,
      tableBounds,
      playerColumnIndex,
      routePeriodId: null,
      alliancePeriods: [
        {
          id: existingPeriodId,
          name: "Latest Period",
          startsAt: "2026-03-01T00:00:00.000Z",
          endsAt: null,
          metrics: [],
        },
      ],
      resolvedProposals: resolved,
    });

    const unassignedPeriodSelect = container.querySelector(
      'select[id="multi-period-target-unassigned-columns"]',
    ) as HTMLSelectElement;
    expect(unassignedPeriodSelect).not.toBeNull();
    expect(unassignedPeriodSelect.value).toBe(UNCONFIRMED_PERIOD_SELECT_VALUE);

    const unassignedMetricSelects = Array.from(
      container.querySelectorAll(
        'select[aria-label="Metric for Hero Power"], select[aria-label="Metric for Kills on 3/4"]',
      ),
    ) as HTMLSelectElement[];
    expect(unassignedMetricSelects).toHaveLength(2);
    for (const select of unassignedMetricSelects) {
      expect(select.value).toBe(UNCONFIRMED_TARGET_TOKEN);
    }

    const previewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Preview Multi-Period Import"),
    ) as HTMLButtonElement;
    expect(previewButton.disabled).toBe(true);

    await selectOptionValue(unassignedPeriodSelect, existingPeriodId);
    expect(previewButton.disabled).toBe(true);

    const heroPowerMetricSelect = container.querySelector(
      'select[aria-label="Metric for Hero Power"]',
    ) as HTMLSelectElement;
    await selectOptionValue(heroPowerMetricSelect, "create");
    expect(previewButton.disabled).toBe(true);
  });

  it("maps textual month-name ranges to period proposals with unknown metric identity", async () => {
    const existingPeriodId = "period-season-7";
    const workbook = buildWorkbookFromRows([
      ["Player", "Jan 27 - Feb 1", "Feb 9 - Feb 15"],
      ["Dragon", "1500", "2000"],
    ]);
    const review = buildPeriodMappingReview({
      sheetName: "Season 7 2026",
      headerRowIndex: 0,
      headers: [
        {
          columnIndex: 0,
          headerText: "Player",
          headerAddress: "A1",
          isPlayerColumn: true,
        },
        {
          columnIndex: 1,
          headerText: "Jan 27 - Feb 1",
          headerAddress: "B1",
          isNumeric: true,
        },
        {
          columnIndex: 2,
          headerText: "Feb 9 - Feb 15",
          headerAddress: "C1",
          isNumeric: true,
        },
      ],
    });
    const { tableBounds, playerColumnIndex } = buildTableContext(workbook);

    await renderFlow({
      review,
      parsedWorkbook: workbook,
      tableBounds,
      playerColumnIndex,
      routePeriodId: null,
      alliancePeriods: [
        {
          id: existingPeriodId,
          name: "Season 7",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: null,
          metrics: [],
        },
      ],
      resolvedProposals: resolveImportProposals(review),
    });

    expect(container.textContent).toContain(UNKNOWN_METRIC_IDENTITY);
    expect(container.textContent).not.toContain('Create "Jan 27"');
    expect(container.textContent).not.toContain('Create "Feb 9"');

    const periodSelects = Array.from(
      container.querySelectorAll('select[id^="multi-period-target-"]'),
    ) as HTMLSelectElement[];
    for (const select of periodSelects) {
      expect(select.value).toBe(CREATE_PERIOD_SELECT_VALUE);
    }

    const previewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Preview Multi-Period Import"),
    ) as HTMLButtonElement;
    expect(previewButton.disabled).toBe(true);
  });

  it("keeps manual-fallback proposals unassigned on guided route when periods exist", async () => {
    const existingPeriodId = "period-existing";
    const workbook = buildWorkbookFromRows([
      ["Player", "VS Score"],
      ["Dragon", "1500"],
    ]);
    const review = buildPeriodMappingReview({
      sheetName: "Results",
      headerRowIndex: 0,
      headers: [
        {
          columnIndex: 0,
          headerText: "Player",
          headerAddress: "A1",
          isPlayerColumn: true,
        },
        {
          columnIndex: 1,
          headerText: "VS Score",
          headerAddress: "B1",
          isNumeric: true,
        },
      ],
    });
    const { tableBounds, playerColumnIndex } = buildTableContext(workbook);

    await renderFlow({
      review,
      parsedWorkbook: workbook,
      tableBounds,
      playerColumnIndex,
      routePeriodId: null,
      alliancePeriods: [
        {
          id: existingPeriodId,
          name: "Season 7",
          startsAt: "2026-01-01T00:00:00.000Z",
          endsAt: null,
          metrics: [],
        },
      ],
      resolvedProposals: resolveImportProposals(review),
    });

    const periodSelect = container.querySelector(
      'select[id^="multi-period-target-"]',
    ) as HTMLSelectElement;
    expect(periodSelect.value).toBe(UNCONFIRMED_PERIOD_SELECT_VALUE);
  });

  it("requires typing a metric name for explicit create and carries it through preview and import", async () => {
    importMock.mockResolvedValue({
      success: true,
      totalCount: 1,
      periods: [],
    });

    const workbook = buildWorkbookFromRows([
      ["Player", "Jan 27 - Feb 1"],
      ["Dragon", "1500"],
    ]);
    const review = buildPeriodMappingReview({
      sheetName: "Season 7 2026",
      headerRowIndex: 0,
      headers: [
        {
          columnIndex: 0,
          headerText: "Player",
          headerAddress: "A1",
          isPlayerColumn: true,
        },
        {
          columnIndex: 1,
          headerText: "Jan 27 - Feb 1",
          headerAddress: "B1",
          isNumeric: true,
        },
      ],
    });
    const { tableBounds, playerColumnIndex } = buildTableContext(workbook);

    await renderFlow({
      review,
      parsedWorkbook: workbook,
      tableBounds,
      playerColumnIndex,
      routePeriodId: null,
      alliancePeriods: [],
      resolvedProposals: resolveImportProposals(review),
    });

    const metricSelect = container.querySelector(
      'select[aria-label="Metric for Jan 27 - Feb 1"]',
    ) as HTMLSelectElement;
    const previewButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Preview Multi-Period Import"),
    ) as HTMLButtonElement;

    await selectOptionValue(metricSelect, "create");
    expect(previewButton.disabled).toBe(true);

    const metricNameInput = container.querySelector(
      'input[aria-label="New metric name for Jan 27 - Feb 1"]',
    ) as HTMLInputElement;
    expect(metricNameInput).not.toBeNull();
    expect(metricNameInput.value).toBe("");

    await fillInputElement(metricNameInput, "Weekly Kills");
    expect(previewButton.disabled).toBe(false);

    await act(async () => {
      previewButton.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(container.textContent).toContain("Weekly Kills");
    expect(container.textContent).toContain("Planned Multi-Period Import");

    const confirmButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.match(/Confirm Multi-Period Import/i),
    ) as HTMLButtonElement;

    await act(async () => {
      confirmButton.click();
      await new Promise((r) => setTimeout(r, 30));
    });

    expect(importMock).toHaveBeenCalledTimes(1);
    const payload = importMock.mock.calls[0]?.[0];
    expect(payload?.groups[0]?.mappings[0]?.target).toEqual({
      kind: "create",
      name: "Weekly Kills",
    });
  });
});

describe("buildManualFallbackProposal", () => {
  it("keeps derived columns out of the fallback proposal", () => {
    const review = buildPeriodMappingReview({
      sheetName: "Results",
      headerRowIndex: 0,
      headers: [
        {
          columnIndex: 0,
          headerText: "Player",
          headerAddress: cellAddress(0, 0),
          isPlayerColumn: true,
        },
        {
          columnIndex: 1,
          headerText: "VS Score",
          headerAddress: cellAddress(0, 1),
          isNumeric: true,
        },
        {
          columnIndex: 2,
          headerText: "Rank #",
          headerAddress: cellAddress(0, 2),
          isNumeric: true,
        },
      ],
    });

    const fallback = buildManualFallbackProposal(review);
    expect(fallback.columns.map((c) => c.headerText)).toEqual(["VS Score"]);
  });
});
