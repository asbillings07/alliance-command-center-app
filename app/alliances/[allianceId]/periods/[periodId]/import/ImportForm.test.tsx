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
        expect(container.textContent).toContain("This workflow does not create roster members.");

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
        expect(container.textContent).toContain("Evaluation Results Imported");
        expect(container.textContent).toContain("Evaluation results have been recorded into destination period 'Week 28 Evaluation'.");
        expect(container.textContent).toContain("Import More Results");
        expect(container.textContent).toContain("View Member Results");
        expect(container.textContent).toContain("View Evaluation Period");
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

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;

        await act(async () => {
            previewBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Invalid Numeric Values Detected in Mapped Columns");

        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import All")
        ) as HTMLButtonElement;

        expect(importBtn).not.toBeNull();
        expect(importBtn.disabled).toBe(true);
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
        expect(container.textContent).toContain("Workbook Cell Issues Detected in Mapped Columns");
        expect(container.textContent).toContain("Cell A2");

        const previewBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Preview Import")
        ) as HTMLButtonElement;
        expect(previewBtn).not.toBeUndefined();
        expect(previewBtn.disabled).toBe(true);
    });
});
