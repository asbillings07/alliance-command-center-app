/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportForm } from "./ImportForm";
import { UNCONFIRMED_TARGET_TOKEN, CREATE_PERIOD_SELECT_VALUE } from "@/app/src/components/spreadsheet/MultiPeriodImportFlow";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({
        push: vi.fn(),
        replace: vi.fn(),
        refresh: mockRefresh,
    }),
}));

vi.mock("@/app/src/components/client", () => ({
    TourButton: () => createElement("button", null, "Tour"),
}));

vi.mock("./action", () => ({
    importMemberMetrics: vi.fn(),
}));

vi.mock("./multiPeriodAction", () => ({
    importMultiPeriodMetrics: vi.fn(),
}));

import { importMemberMetrics } from "./action";
import { importMultiPeriodMetrics } from "./multiPeriodAction";

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

import * as XLSX from "xlsx";

function setupMockFileReader(fileContent: string | ArrayBuffer) {
    class MockFileReader {
        result: string | ArrayBuffer | null = null;
        onload: ((e: { target: { result: string | ArrayBuffer } }) => void) | null = null;
        readAsText() {
            setTimeout(() => {
                const str = typeof fileContent === "string" ? fileContent : new TextDecoder().decode(fileContent);
                this.result = str;
                if (this.onload) {
                    this.onload({ target: { result: str } });
                }
            }, 0);
        }
        readAsArrayBuffer() {
            setTimeout(() => {
                const buf = typeof fileContent === "string" ? new TextEncoder().encode(fileContent).buffer : fileContent;
                this.result = buf;
                if (this.onload) {
                    this.onload({ target: { result: buf } });
                }
            }, 0);
        }
    }
    window.FileReader = MockFileReader as unknown as typeof FileReader;
}

function fireFileUpload(fileContent: string | ArrayBuffer, fileName = "results.csv") {
    setupMockFileReader(fileContent);
    const fileInput = container.querySelector("#csv-upload") as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File([fileContent], fileName, {
        type: fileName.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
    });
    Object.defineProperty(fileInput, "files", {
        value: [file],
        writable: true,
        configurable: true,
    });

    const event = new Event("change", { bubbles: true });
    fileInput.dispatchEvent(event);
}

function selectOptionValue(select: HTMLSelectElement, nextValue: string) {
    expect(select.value).not.toBe(nextValue);
    select.value = nextValue;
    select.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("ImportForm [component]", () => {
    const periodId = "period-1";
    const periodName = "Week 28 Evaluation";
    const allianceId = "alliance-1";
    const members = [
        { id: "m1", playerName: "Dragon" },
        { id: "m2", playerName: "Phoenix" },
    ];
    const metrics = [
        { id: "met1", name: "Kill Points" },
    ];
    const allianceLibraryMetrics = [
        { id: "lib-kills", name: "Kills" },
        ...metrics,
    ];
    const alliancePeriods = [
        {
            id: periodId,
            name: periodName,
            startsAt: null,
            endsAt: null,
            metrics,
        },
    ];

    it("displays persistent destination period banner, scope notice, and sr-only accessible file input", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        // Banner check
        expect(container.textContent).toContain("Destination Period: Week 28 Evaluation");

        // Scope notice check
        expect(container.textContent).toContain("Destination: Week 28 Evaluation");
        expect(container.textContent).toContain("Expected Metric Spreadsheet Format (Week 28 Evaluation)");

        // Accessible input check
        const fileInput = container.querySelector<HTMLInputElement>("#csv-upload");
        expect(fileInput).not.toBeNull();
        expect(fileInput?.className).toContain("sr-only");
        expect(fileInput?.className).not.toContain("hidden");
        expect(fileInput?.getAttribute("aria-label")).toContain("Upload evaluation results spreadsheet (.csv, .xlsx, .xls)");
    });

    it("completes import flow with outcome-based success terminology and destination period context", async () => {
        (importMemberMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
            perMetric: [{ metricId: "met1", name: "Kill Points", count: 2 }],
            totalCount: 2,
            created: [],
            attached: [],
            reused: [{ metricId: "met1", name: "Kill Points" }],
        });

        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        const csvContent = `Player,Kill Points\nDragon,1500\nPhoenix,2300`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Click Preview
        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Click Import All
        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import All")
        ) as HTMLButtonElement;

        await act(async () => {
            importBtn.click();
        });

        // Assert completion copy
        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(importMemberMetrics).toHaveBeenCalledWith(
            expect.objectContaining({
                periodId,
                allianceId,
                mappings: expect.arrayContaining([
                    expect.objectContaining({
                        sourceColumnName: "Kill Points",
                    }),
                ]),
            })
        );
        expect(container.textContent).toContain("Evaluation Results Imported");
        expect(container.textContent).toContain("Evaluation results have been recorded into destination period 'Week 28 Evaluation'.");
        expect(container.textContent).toContain("Import More Results");
        expect(container.textContent).toContain("View Member Results");
        expect(container.textContent).toContain("View Evaluation Period");
    });

    it("defaults brand-new numeric columns to create when the user can configure metrics", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const csvContent = `Player,Donations\nDragon,1500\nPhoenix,2300`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Known metric matches are mapped automatically");

        const metricSelect = container.querySelector<HTMLSelectElement>(
            'select[aria-label="Metric for Donations"]'
        );
        expect(metricSelect).not.toBeNull();
        expect(metricSelect?.value).toBe("create");
        expect(container.textContent).toContain("Donations");
        expect(container.textContent).toContain("New metric");
    });

    it("previews localized thousands separators correctly (450.000.000 -> 450,000,000)", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        const csvContent = `Player,Kill Points\nDragon,450.000.000\nPhoenix,"450,000,000"`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("450,000,000");
    });

    it("displays blocking error banner and disables Import button when invalid numeric cells exist in mapped column", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        const csvContent = `Player,Kill Points\nDragon,1500\nPhoenix,450.5`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Fix 1 spreadsheet cell before previewing");
        expect(container.textContent).toContain("Column: Kill Points");
        expect(container.textContent).toContain('Kill Points: B3');
        expect(container.textContent).toContain('450.5');
        expect(container.textContent).not.toContain("Parse Feedback");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;

        expect(previewBtn).not.toBeNull();
        expect(previewBtn.disabled).toBe(true);
    });

    it("displays sheet selector for multi-sheet XLSX workbooks and switches sheets before previewing", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        // Create multi-sheet XLSX workbook
        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet([["Player", "Kill Points"], ["Dragon", "100"]]);
        const ws2 = XLSX.utils.aoa_to_sheet([["Player", "Kill Points"], ["Dragon", "200"]]);
        XLSX.utils.book_append_sheet(wb, ws1, "Sheet A");
        XLSX.utils.book_append_sheet(wb, ws2, "Sheet B");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "multi_results.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        // Verify sheet selector buttons exist
        expect(container.textContent).toContain("Sheet A");
        expect(container.textContent).toContain("Sheet B");

        // Click Sheet B
        const sheetBBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Sheet B")
        ) as HTMLButtonElement;
        expect(sheetBBtn).not.toBeUndefined();

        await act(async () => {
            sheetBBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Preview import
        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Should render 200 from Sheet B
        expect(container.textContent).toContain("200");
    });

    it("displays blocking cell issues banner and disables import when error cell exists in player name column", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        // Create workbook with an error cell (#REF!) in cell A2 (Player Name column)
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([["Player", "Kill Points"], ["Dragon", "100"]]);
        ws["A2"] = { t: "e", v: 0x17, w: "#REF!" };
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "player_error.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        // Verify blocking diagnostic banner is displayed directly on the mapping step for cell A2
        expect(container.textContent).toContain("Fix 1 spreadsheet cell before importing");
        expect(container.textContent).toContain("Column: Player");
        expect(container.textContent).toContain("Player (A2)");
        expect(container.textContent).not.toContain("Workbook Cell Issues Detected");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;
        expect(previewBtn).not.toBeUndefined();
        expect(previewBtn.disabled).toBe(true);
    });

    it("requires user confirmation for low-confidence or multi-region tables and unlocks Preview upon confirmation", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        // Multi-table CSV with side-by-side player columns
        const csvContent = `Player,Kill Points,,,Player Name,VS Score\nDragon,1500,,,Phoenix,2300`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Check that multi-table region selector is present
        expect(container.textContent).toContain("Multiple Tables Detected on Sheet");
        expect(container.textContent).toContain("Confirm Header & Table Region");

        // Preview button should be disabled before confirmation
        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;
        expect(previewBtn).not.toBeUndefined();
        expect(previewBtn.disabled).toBe(true);

        // Click "Confirm Header & Table Region"
        const confirmBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Confirm Header & Table Region")
        ) as HTMLButtonElement;
        expect(confirmBtn).not.toBeUndefined();

        await act(async () => {
            confirmBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Upon confirmation, header confirmation card disappears and preview button is enabled
        expect(container.textContent).not.toContain("Confirm Header Row & Table Region");
        expect(previewBtn.disabled).toBe(false);
    });

    it("displays truthful error notice when player name is missing for populated metric cells without saying whole numbers", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        // CSV with empty player name in data row 2
        const csvContent = `Player,Kill Points\nDragon,1500\n,2000`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Fix 1 spreadsheet cell before previewing");
        expect(container.textContent).toContain("Missing player name in cell A3");
        expect(container.textContent).not.toContain("whole numbers");
    });

    it("ignores cell issues outside active data region (e.g. summary or footer rows)", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        // Create workbook with an error cell in a summary/footer row below dataEndIndex
        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kill Points"],
            ["Dragon", "1000"],
            ["Total", "1000"],
            ["Footnote", "#REF!"],
        ]);
        ws["B4"] = { t: "e", v: 0x17, w: "#REF!" };
        XLSX.utils.book_append_sheet(wb, ws, "Sheet1");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "footer_error.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        // The error in row 4 (B4) is after 'Total' (dataEndIndex = 2), so it shouldn't block preview
        expect(container.textContent).not.toContain("Fix 1 spreadsheet cell before importing");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;
        expect(previewBtn).not.toBeUndefined();
        expect(previewBtn.disabled).toBe(false);
    });

    it("requires explicit confirmation for period-like columns and blocks Preview until confirmed", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        // CSV with a period-like column "VS 7"
        const csvContent = `Player,VS 7\nDragon,1500`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Inferential period notice card should be displayed
        expect(container.textContent).toContain("This file may include multiple periods");
        expect(container.textContent).toContain("Looks like a period name");
        expect(container.textContent).toContain("Confirmation required");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;
        expect(previewBtn).not.toBeUndefined();
        expect(previewBtn.disabled).toBe(true);

        // Click "Skip this column"
        const skipBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Skip this column")
        ) as HTMLButtonElement;
        expect(skipBtn).not.toBeUndefined();

        await act(async () => {
            skipBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Notice card should disappear, but no active columns mapped so preview disabled
        expect(container.textContent).not.toContain("This file may include multiple periods");
    });

    it("allows keeping period-like column as metric when explicitly confirmed by leader", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        const csvContent = `Player,VS 7\nDragon,1500`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Click "Keep as metric for Week 28 Evaluation"
        const keepBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Keep as metric for Week 28 Evaluation")
        ) as HTMLButtonElement;
        expect(keepBtn).not.toBeUndefined();

        await act(async () => {
            keepBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).not.toContain("This file may include multiple periods");
        expect(container.textContent).toContain("New metric: \u201cVS 7\u201d");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;
        expect(previewBtn.disabled).toBe(false);
    });

    it("handles VS Score as a metric keyword while VS 7 triggers period confirmation on the same sheet", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics: [{ id: "m-vs", name: "VS Score" }],
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        const csvContent = `Player,VS Score,VS 7\nDragon,2500,1800`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // VS Score matches existing metric without requiring confirmation
        // VS 7 triggers period confirmation notice
        expect(container.textContent).toContain("This file may include multiple periods");
        expect(container.textContent).toContain("\u201cVS 7\u201d");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;
        expect(previewBtn.disabled).toBe(true);

        // Skip VS 7
        const skipBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Skip this column")
        ) as HTMLButtonElement;

        await act(async () => {
            skipBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // VS Score remains mapped, preview enabled
        expect(container.textContent).not.toContain("This file may include multiple periods");
        expect(previewBtn.disabled).toBe(false);
    });

    it("requires explicit confirmation for ambiguous columns like Score and unlocks Preview upon confirmation", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        // CSV with a known metric (Kill Points) and an ambiguous column ("Score")
        const csvContent = `Player,Kill Points,Score\nDragon,1500,2000`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // "Score" should be identified as an ambiguous column requiring confirmation
        expect(container.textContent).toContain("Ambiguous column \u2014 confirm choice");
        expect(container.textContent).toContain("Confirmation required");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;
        expect(previewBtn).not.toBeUndefined();
        expect(previewBtn.disabled).toBe(true);

        // Click "Confirm Do not import" on the ambiguous column row
        const confirmBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Confirm Do not import")
        ) as HTMLButtonElement;
        expect(confirmBtn).not.toBeUndefined();

        await act(async () => {
            confirmBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Score is confirmed skipped, Kill Points remains mapped, Preview becomes enabled
        expect(container.textContent).toContain("Confirmed Do not import");
        expect(previewBtn.disabled).toBe(false);
    });

    it("displays error message and does not assign arbitrary metric when leader without create permission confirms period column", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        const csvContent = `Player,VS 7\nDragon,1500`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        const keepBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Keep as metric for Week 28 Evaluation")
        ) as HTMLButtonElement;

        await act(async () => {
            keepBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Must NOT silently assign "VS 7" to unrelated metric "Kill Points"
        expect(container.textContent).toContain("requires metric configuration permission");
        expect(container.textContent).not.toContain("New metric");
    });

    it("displays pre-upload data shape guide, all-column translation cards with sample values, and planned/committed summaries", async () => {
        (importMemberMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
            perMetric: [{ metricId: "met1", name: "Kill Points", count: 2 }],
            totalCount: 2,
            created: [],
            attached: [],
            reused: [{ metricId: "met1", name: "Kill Points" }],
        });

        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        // 1. Pre-upload format guide
        expect(container.textContent).toContain("Expected Metric Spreadsheet Format (Week 28 Evaluation)");
        expect(container.textContent).toContain("Copy Sample CSV");
        expect(container.textContent).toContain("Download .csv Template");

        const csvContent = `Player,Kill Points,Freeform Notes,Empty Col\nDragon,1500,Good run,\nPhoenix,2300,Great effort,`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Click Preview Import
        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // 2. Planned Metric Translation Summary and Column Translation Cards
        expect(container.textContent).toContain("Planned Metric Translation");
        expect(container.textContent).toContain("Source Column Translations");

        // Column translation status badges
        expect(container.textContent).toContain("Mapped: Member Identity");
        expect(container.textContent).toContain("Mapped: Existing Metric");
        expect(container.textContent).toContain("Excluded: Free-form text / unsupported non-numeric column");
        expect(container.textContent).toContain("Ignored: No values in column");

        // Sample values displayed
        expect(container.textContent).toContain('"Dragon"');
        expect(container.textContent).toContain('"1500"');
        expect(container.textContent).toContain('"Good run"');

        // 3. Complete step with committed metric summary
        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import All")
        ) as HTMLButtonElement;

        await act(async () => {
            importBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Committed Metric Translation");
        expect(container.textContent).toContain("Total Entries Committed");
        expect(container.textContent).toContain("Reused / Attached Metrics");
    });

    it("updates previews and server payload when changing a column target after entering preview", async () => {
        (importMemberMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
            perMetric: [{ metricId: "met1", name: "Kill Points", count: 2 }],
            totalCount: 2,
            created: [],
            attached: [],
            reused: [{ metricId: "met1", name: "Kill Points" }],
        });

        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        // Upload CSV with Player, Kill Points and Hero Power (both match existing metrics met1 and met2)
        const csvContent = `Player,Kill Points,Hero Power\nDragon,1500,200\nPhoenix,2300,400`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Click Preview Import
        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Verify initially in Preview step
        expect(container.textContent).toContain("Planned Metric Translation");

        // Change Action dropdown for Hero Power (value: "create") to "skip" while in preview step
        const selects = Array.from(container.querySelectorAll("select"));
        const heroPowerSelect = selects.find((s) => s.value === "create") as HTMLSelectElement;
        expect(heroPowerSelect).not.toBeUndefined();

        await act(async () => {
            heroPowerSelect.value = "skip";
            heroPowerSelect.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 50));
        });

        // Click Import All
        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import All")
        ) as HTMLButtonElement;

        await act(async () => {
            importBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Assert importMemberMetrics was called with ONLY Kill Points (Hero Power was skipped!)
        expect(importMemberMetrics).toHaveBeenCalledTimes(1);
        const payload = (importMemberMetrics as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(payload.mappings).toHaveLength(1);
        expect(payload.mappings[0].sourceColumnName).toBe("Kill Points");
        expect(payload.mappings[0].target).toEqual({ kind: "existing", metricId: "met1" });
    });

    it("displays read-only multi-period proposal review when date-stamped columns are uploaded and lets leader decline", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Kills on 4/13", "% Change"],
            ["Dragon", "1500", "2000", "33%"],
            ["Phoenix", "2300", "3000", "30%"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "multi_period_results.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Multi-Period Spreadsheet Detected");
        expect(container.textContent).toContain("Decline & Use Selected Period Instead");
        expect(container.textContent).toContain("Excluded columns");
        expect(container.textContent).toContain("Medium confidence");
        expect(container.textContent).toContain("Fixed-period import is paused");
        expect(container.textContent).not.toContain("Map Columns to Metrics");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        );
        expect(previewBtn).toBeUndefined();

        const declineBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Decline & Use Selected Period Instead")
        ) as HTMLButtonElement;
        expect(declineBtn).not.toBeUndefined();

        await act(async () => {
            declineBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).not.toContain("Multi-Period Spreadsheet Detected");
        expect(container.textContent).not.toContain("Fixed-period import is paused");
        expect(container.textContent).toContain("Map Columns to Metrics");
        expect(container.textContent).toContain("Destination Period: Week 28 Evaluation");
    });

    it("opens multi-period mapping flow only for multi_period mode", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Kills on 4/13", "% Change"],
            ["Dragon", "1500", "2000", "33%"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "multi_period_flow.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        const reviewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Review & Map to Existing Periods"),
        ) as HTMLButtonElement;
        expect(reviewBtn).not.toBeUndefined();

        await act(async () => {
            reviewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Map proposals to evaluation periods");
        expect(container.textContent).toContain("Default target evaluation period");
        expect(container.textContent).toContain("Preview Multi-Period Import");
    });

    it("previews multi-period import grouped by period and confirms with grouped server payload", async () => {
        const secondPeriodId = "period-2";
        const secondPeriodName = "Week 29 Evaluation";
        const twoAlliancePeriods = [
            {
                id: periodId,
                name: periodName,
                startsAt: "2026-03-29T00:00:00.000Z",
                endsAt: "2026-04-05T00:00:00.000Z",
                metrics,
            },
            {
                id: secondPeriodId,
                name: secondPeriodName,
                startsAt: "2026-04-06T00:00:00.000Z",
                endsAt: "2026-04-13T00:00:00.000Z",
                metrics,
            },
        ];

        (importMultiPeriodMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
            success: true,
            totalCount: 4,
            periods: [
                {
                    periodId,
                    periodName,
                    totalCount: 2,
                    perMetric: [{ metricId: "new-kills", name: "Kills on 3/29", count: 2 }],
                    created: [{ metricId: "new-kills", name: "Kills on 3/29" }],
                    attached: [],
                    reused: [],
                },
                {
                    periodId: secondPeriodId,
                    periodName: secondPeriodName,
                    totalCount: 2,
                    perMetric: [{ metricId: "new-kills-2", name: "Kills on 4/13", count: 2 }],
                    created: [{ metricId: "new-kills-2", name: "Kills on 4/13" }],
                    attached: [],
                    reused: [],
                },
            ],
        });

        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods: twoAlliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Kills on 4/13"],
            ["Dragon", "1500", "2000"],
            ["Phoenix", "2300", "3000"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "multi_period_confirm.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        const reviewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Review & Map to Existing Periods"),
        ) as HTMLButtonElement;

        await act(async () => {
            reviewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const columnPeriodSelects = Array.from(
            container.querySelectorAll('select[id^="multi-period-column-period-"]'),
        ) as HTMLSelectElement[];
        expect(columnPeriodSelects.length).toBeGreaterThanOrEqual(2);

        await act(async () => {
            columnPeriodSelects[1].value = secondPeriodId;
            columnPeriodSelects[1].dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 50));
        });

        const metricSelects = Array.from(container.querySelectorAll("select")).filter((s) =>
            s.getAttribute("aria-label")?.startsWith("Metric for"),
        ) as HTMLSelectElement[];
        expect(metricSelects.length).toBeGreaterThanOrEqual(2);

        await act(async () => {
            for (const select of metricSelects) {
                select.value = "create";
                select.dispatchEvent(new Event("change", { bubbles: true }));
            }
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Detected metric: Kills");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Multi-Period Import"),
        ) as HTMLButtonElement;
        expect(previewBtn.disabled).toBe(false);

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Planned Multi-Period Import");
        expect(container.textContent).toContain("no database changes until you confirm");
        expect(container.textContent).toContain(periodName);
        expect(container.textContent).toContain(secondPeriodName);

        const confirmBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Confirm Multi-Period Import"),
        ) as HTMLButtonElement;

        await act(async () => {
            confirmBtn.click();
            await new Promise((r) => setTimeout(r, 100));
        });

        expect(importMultiPeriodMetrics).toHaveBeenCalledTimes(1);
        const payload = (importMultiPeriodMetrics as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(payload.allianceId).toBe(allianceId);
        expect(payload.groups).toHaveLength(2);
        expect(
            payload.groups.map((group: { target: { kind: string; periodId?: string } }) =>
                group.target.kind === "existing" ? group.target.periodId : group.target.kind,
            ).sort(),
        ).toEqual([periodId, secondPeriodId].sort());
        for (const group of payload.groups) {
            for (const mapping of group.mappings) {
                expect(mapping.target).toEqual({ kind: "create", name: "Kills" });
            }
        }
        expect(container.textContent).toContain("Multi-Period Import Complete");
    });

    it("allows excluding one proposal and previewing the remaining mapped proposal", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Kills on 4/13"],
            ["Dragon", "1500", "2000"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "multi_period_exclude_proposal.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        const reviewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Review & Map to Existing Periods"),
        ) as HTMLButtonElement;

        await act(async () => {
            reviewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const excludeCheckboxes = Array.from(container.querySelectorAll('input[type="checkbox"]')).filter(
            (input) => input.closest("label")?.textContent?.includes("Exclude this proposal"),
        );
        expect(excludeCheckboxes.length).toBeGreaterThanOrEqual(2);

        await act(async () => {
            (excludeCheckboxes[1] as HTMLInputElement).click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const metricSelect = container.querySelector(
            'select[aria-label="Metric for Kills on 3/29"]',
        ) as HTMLSelectElement;
        expect(metricSelect).not.toBeNull();

        await act(async () => {
            metricSelect.value = "create";
            metricSelect.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 50));
        });

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Multi-Period Import"),
        ) as HTMLButtonElement;
        expect(previewBtn.disabled).toBe(false);

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Planned Multi-Period Import");
        expect(container.textContent).toContain("1 periods");
    });

    it("blocks fixed-period mapping until multi-period proposal is explicitly declined", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Kills on 4/13"],
            ["Dragon", "1500", "2000"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "blocked_until_decline.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Fixed-period import is paused");
        expect(container.querySelector('select[aria-label="Metric for Kills on 3/29"]')).toBeNull();
    });

    it("does not block fixed-period mapping for a single-period suggestion", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const csvContent = `Player,Kills on 3/29/2026\nDragon,1500\nPhoenix,2300`;

        await act(async () => {
            fireFileUpload(csvContent, "single_period_suggestion.csv");
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Single Evaluation Period Suggested");
        expect(container.textContent).not.toContain("Fixed-period import is paused");
        expect(container.textContent).toContain("Map Columns to Metrics");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;
        expect(previewBtn).not.toBeUndefined();
    });

    it("shows both endpoints for reviewable range evidence in the confirmation card", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const csvContent = `Player,Kills from 3/29-4/13\nDragon,1500\nPhoenix,2300`;

        await act(async () => {
            fireFileUpload(csvContent, "reviewable_range.csv");
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Columns needing confirmation");
        expect(container.textContent).toContain("3/29 – 4/13 (year unknown)");
    });

    it("uses detected header row for source addresses when a title row precedes headers", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Alliance Weekly Stats", "", ""],
            ["Player", "Kills on 3/29/2026", "Kills on 4/13/2026"],
            ["Dragon", "1500", "2000"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "title_row.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("header row 2");
    });

    it("blocks multi-period preview until every included column is explicitly confirmed or skipped", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                    canConfigurePeriods: false,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Kills on 4/13"],
            ["Dragon", "1500", "2000"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "multi_period_unconfirmed.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        const reviewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Review & Map to Existing Periods"),
        ) as HTMLButtonElement;
        await act(async () => {
            reviewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Multi-Period Import"),
        ) as HTMLButtonElement;
        expect(previewBtn.disabled).toBe(true);

        const metricSelect = container.querySelector(
            'select[aria-label="Metric for Kills on 3/29"]',
        ) as HTMLSelectElement;
        const secondMetricSelect = container.querySelector(
            'select[aria-label="Metric for Kills on 4/13"]',
        ) as HTMLSelectElement;

        expect(metricSelect.value).toBe(UNCONFIRMED_TARGET_TOKEN);
        expect(secondMetricSelect.value).toBe(UNCONFIRMED_TARGET_TOKEN);
        expect(
            Array.from(metricSelect.options).some((o) => o.value === UNCONFIRMED_TARGET_TOKEN),
        ).toBe(true);
        expect(
            Array.from(metricSelect.options).some((o) => o.value === "skip" && o.textContent?.includes("Do not import")),
        ).toBe(true);

        await act(async () => {
            selectOptionValue(metricSelect, "skip");
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(metricSelect.value).toBe("skip");
        expect(previewBtn.disabled).toBe(true);

        await act(async () => {
            selectOptionValue(secondMetricSelect, `existing:${metrics[0].id}`);
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(previewBtn.disabled).toBe(false);
    });

    it("allows two proposals to target the same evaluation period", async () => {
        const secondPeriodId = "period-2";
        const twoAlliancePeriods = [
            {
                id: periodId,
                name: periodName,
                startsAt: "2026-03-29T00:00:00.000Z",
                endsAt: "2026-04-05T00:00:00.000Z",
                metrics,
            },
            {
                id: secondPeriodId,
                name: "Week 29 Evaluation",
                startsAt: "2026-04-06T00:00:00.000Z",
                endsAt: "2026-04-13T00:00:00.000Z",
                metrics: [{ id: "met2", name: "Hero Power" }],
            },
        ];

        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods: twoAlliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Hero Power on 4/13"],
            ["Dragon", "1500", "2000"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "same_period_two_proposals.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        const reviewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Review & Map to Existing Periods"),
        ) as HTMLButtonElement;
        await act(async () => {
            reviewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const metricSelects = Array.from(container.querySelectorAll("select")).filter((s) =>
            s.getAttribute("aria-label")?.startsWith("Metric for"),
        ) as HTMLSelectElement[];

        await act(async () => {
            for (const select of metricSelects) {
                if (select.value === "") {
                    select.value = "create";
                    select.dispatchEvent(new Event("change", { bubbles: true }));
                }
            }
            await new Promise((r) => setTimeout(r, 50));
        });

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Multi-Period Import"),
        ) as HTMLButtonElement;
        expect(previewBtn.disabled).toBe(false);

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("1 periods");
    });

    it("offers attachable alliance metrics for a non-route target period", async () => {
        const secondPeriodId = "period-2";
        const killsOnPeriodA = { id: "lib-kills", name: "Kills" };
        const twoAlliancePeriods = [
            {
                id: periodId,
                name: periodName,
                startsAt: "2026-03-29T00:00:00.000Z",
                endsAt: "2026-04-05T00:00:00.000Z",
                metrics: [killsOnPeriodA],
            },
            {
                id: secondPeriodId,
                name: "Week 29 Evaluation",
                startsAt: "2026-04-06T00:00:00.000Z",
                endsAt: "2026-04-13T00:00:00.000Z",
                metrics: [],
            },
        ];

        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics: [killsOnPeriodA],
                    libraryMetrics: [],
                    allianceLibraryMetrics: [killsOnPeriodA],
                    alliancePeriods: twoAlliancePeriods,
                    canCreateMetrics: false,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Kills on 4/13"],
            ["Dragon", "1500", "2000"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "attach_on_period_b.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        const reviewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Review & Map to Existing Periods"),
        ) as HTMLButtonElement;
        await act(async () => {
            reviewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const columnPeriodSelects = Array.from(
            container.querySelectorAll('select[id^="multi-period-column-period-"]'),
        ) as HTMLSelectElement[];
        await act(async () => {
            columnPeriodSelects[1].value = secondPeriodId;
            columnPeriodSelects[1].dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 50));
        });

        const metricSelect = container.querySelector(
            'select[aria-label="Metric for Kills on 4/13"]',
        ) as HTMLSelectElement;
        const attachOption = Array.from(metricSelect.options).find((o) =>
            o.value.startsWith("attach:lib-kills"),
        );
        expect(attachOption).not.toBeUndefined();
    });

    it("associates default proposal period selectors with visible labels", async () => {
        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                })
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Kills on 4/13"],
            ["Dragon", "1500", "2000"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "multi_period_a11y.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        const reviewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Review & Map to Existing Periods"),
        ) as HTMLButtonElement;
        await act(async () => {
            reviewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const periodSelect = container.querySelector(
            'select[id^="multi-period-target-"]',
        ) as HTMLSelectElement;
        expect(periodSelect).not.toBeNull();
        expect(periodSelect.id).toBeTruthy();
        const label = container.querySelector(`label[for="${periodSelect.id}"]`);
        expect(label?.textContent).toContain("Default target evaluation period");
    });

    it("supports creating a new period with editable prefilled fields and sends create target payload", async () => {
        const createdPeriodName = "March 2026";
        (importMultiPeriodMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
            success: true,
            totalCount: 2,
            periods: [
                {
                    periodId: "created-period-id",
                    periodName: createdPeriodName,
                    totalCount: 2,
                    perMetric: [{ metricId: "new-kills", name: "Kills", count: 2 }],
                    created: [{ metricId: "new-kills", name: "Kills" }],
                    attached: [],
                    reused: [],
                },
            ],
        });

        await act(async () => {
            root.render(
                createElement(ImportForm, {
                    periodId,
                    periodName,
                    allianceId,
                    members,
                    metrics,
                    libraryMetrics: [],
                    allianceLibraryMetrics,
                    alliancePeriods,
                    canCreateMetrics: true,
                    canAttachMetrics: true,
                    canConfigurePeriods: true,
                }),
            );
        });

        const wb = XLSX.utils.book_new();
        const ws = XLSX.utils.aoa_to_sheet([
            ["Player", "Kills on 3/29", "Kills on 4/13"],
            ["Dragon", "1500", "2000"],
            ["Phoenix", "2300", "3000"],
        ]);
        XLSX.utils.book_append_sheet(wb, ws, "March 2026");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, "multi_period_create.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        const reviewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Review & Map to Existing Periods"),
        ) as HTMLButtonElement;
        await act(async () => {
            reviewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const excludeCheckboxes = Array.from(
            container.querySelectorAll('input[type="checkbox"]'),
        ).filter((input) =>
            input.closest("label")?.textContent?.includes("Exclude this proposal"),
        ) as HTMLInputElement[];
        await act(async () => {
            excludeCheckboxes[1]?.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const periodSelect = container.querySelector(
            'select[id^="multi-period-target-"]',
        ) as HTMLSelectElement;
        selectOptionValue(periodSelect, CREATE_PERIOD_SELECT_VALUE);

        const nameInput = container.querySelector(
            'input[id^="multi-period-target-"][id$="-name"]',
        ) as HTMLInputElement;
        expect(nameInput.value.trim().length).toBeGreaterThan(0);

        await act(async () => {
            nameInput.value = createdPeriodName;
            nameInput.dispatchEvent(new Event("change", { bubbles: true }));
            await new Promise((r) => setTimeout(r, 50));
        });

        const metricSelect = container.querySelector(
            'select[aria-label^="Metric for"]',
        ) as HTMLSelectElement;
        selectOptionValue(metricSelect, "create");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Multi-Period Import"),
        ) as HTMLButtonElement;

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        const confirmBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Confirm Multi-Period Import"),
        ) as HTMLButtonElement;
        await act(async () => {
            confirmBtn.click();
            await new Promise((r) => setTimeout(r, 100));
        });

        expect(importMultiPeriodMetrics).toHaveBeenCalledTimes(1);
        const payload = (importMultiPeriodMetrics as ReturnType<typeof vi.fn>).mock.calls[0][0];
        expect(payload.groups).toHaveLength(1);
        expect(payload.groups[0].target.kind).toBe("create");
        expect(payload.groups[0].target.name).toBeTruthy();
        expect(payload.groups[0].mappings).toHaveLength(1);
    });
});
