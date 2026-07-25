/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportForm } from "./ImportForm";

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

import { importMemberMetrics } from "./action";

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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
                })
            );
        });

        // Banner check
        expect(container.textContent).toContain("Destination Period: Week 28 Evaluation");

        // Scope notice check
        expect(container.textContent).toContain("Evaluation Results Import Scope");
        expect(container.textContent).toContain("This workflow does not create members.");

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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
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
                    canCreateMetrics: true,
                    canAttachMetrics: true,
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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
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
                    canCreateMetrics: true,
                    canAttachMetrics: false,
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
                    canCreateMetrics: true,
                    canAttachMetrics: false,
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
                    canCreateMetrics: true,
                    canAttachMetrics: false,
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
                    canCreateMetrics: true,
                    canAttachMetrics: false,
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
                    canCreateMetrics: false,
                    canAttachMetrics: false,
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
});
