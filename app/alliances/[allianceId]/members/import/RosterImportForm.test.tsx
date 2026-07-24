/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RosterImportForm } from "./RosterImportForm";

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
    importMembers: vi.fn(),
}));

import { importMembers } from "./action";

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

function fireFileUpload(fileContent: string | ArrayBuffer, fileSize?: number, fileName = "roster.csv") {
    setupMockFileReader(fileContent);
    const fileInput = container.querySelector("#roster-file") as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const size = fileSize ?? (typeof fileContent === "string" ? fileContent.length : fileContent.byteLength);
    const file = new File([fileContent], fileName, {
        type: fileName.endsWith(".xlsx") ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" : "text/csv",
    });
    Object.defineProperty(file, "size", { value: size });

    Object.defineProperty(fileInput, "files", {
        value: [file],
        writable: true,
        configurable: true,
    });

    const event = new Event("change", { bubbles: true });
    fileInput.dispatchEvent(event);
}

describe("RosterImportForm [component]", () => {
    const allianceId = "alliance-1";
    const existingMembers = [
        { id: "m1", playerName: "Existing Active One", archivedAt: null },
        { id: "m2", playerName: "Existing Archived One", archivedAt: "2026-01-01T00:00:00.000Z" },
    ];

    it("displays scope notice, sr-only accessible file input, and correct completion copy", async () => {
        (importMembers as ReturnType<typeof vi.fn>).mockResolvedValue({
            created: 1,
            restored: 0,
            skippedExisting: 0,
            skippedDuplicates: 0,
            skippedEmptyNames: 0,
            skippedUnselected: 0,
            errors: [],
        });

        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers: [],
                })
            );
        });

        // Scope notice check
        expect(container.textContent).toContain("Member Import Scope");
        expect(container.textContent).toContain("This page imports member details: Name, Total Hero Power (THP), and Role. It does not import evaluation results.");

        // Accessible file input check
        const fileInput = container.querySelector<HTMLInputElement>("#roster-file");
        expect(fileInput).not.toBeNull();
        expect(fileInput?.className).toContain("sr-only");
        expect(fileInput?.className).not.toContain("hidden");
        expect(fileInput?.getAttribute("aria-label")).toContain("Import member spreadsheet (.csv, .xlsx, .xls)");

        // File upload
        await act(async () => {
            fireFileUpload(`Player\nCandidate A`);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Click import button
        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import")
        ) as HTMLButtonElement;

        await act(async () => {
            importBtn.click();
        });

        // Check completion copy
        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain("Members Imported");
        expect(container.textContent).toContain("Import More Members");
    });

    it("parses CSV, highlights duplicate rows, deselects duplicates by default, and sends submitted payload with selected: false for duplicates", async () => {
        (importMembers as ReturnType<typeof vi.fn>).mockResolvedValue({
            created: 2,
            restored: 0,
            skippedExisting: 0,
            skippedDuplicates: 1,
            skippedEmptyNames: 0,
            skippedUnselected: 0,
            errors: [],
        });

        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers: [],
                })
            );
        });

        const csvContent = `Player,THP,Role
New Player A,50000,R4
New Player A,50000,R4
New Player B,60000,R3`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Check duplicate CSV banner is displayed
        expect(container.textContent).toContain("1 Duplicate Row Highlighted in File");
        expect(container.textContent).toContain("Duplicate in File");

        // Verify "Select All" checkbox behavior: toggling select all does NOT select the duplicate CSV row
        const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
        const selectAllCheckbox = checkboxes[0]; // Header checkbox

        // Uncheck all
        await act(async () => {
            selectAllCheckbox.click();
        });

        // Re-check all
        await act(async () => {
            selectAllCheckbox.click();
        });

        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import")
        ) as HTMLButtonElement;

        await act(async () => {
            importBtn.click();
        });

        expect(importMembers).toHaveBeenCalledTimes(1);
        const submittedEntries = (importMembers as ReturnType<typeof vi.fn>).mock.calls[0][1];

        // First row "New Player A" is selected: true
        expect(submittedEntries[0]).toMatchObject({ playerName: "New Player A", selected: true });
        // Second row "New Player A" (duplicate in file) MUST have selected: false
        expect(submittedEntries[1]).toMatchObject({ playerName: "New Player A", selected: false });
        // Third row "New Player B" is selected: true
        expect(submittedEntries[2]).toMatchObject({ playerName: "New Player B", selected: true });
    });

    it("enforces 5 MB file size limit on upload", async () => {
        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers,
                })
            );
        });

        const hugeSize = 5 * 1024 * 1024 + 1; // 5 MB + 1 byte
        await act(async () => {
            fireFileUpload("Player\nCandidate A", hugeSize);
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("exceeds the maximum limit of 5.0 MB");
    });

    it("reclassifies player name dynamically when edited in the preview table", async () => {
        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers, // Existing Active One, Existing Archived One
                })
            );
        });

        // Upload CSV with "Existing Active One" and "Candidate B"
        await act(async () => {
            fireFileUpload("Player\nExisting Active One\nCandidate B");
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Import 1 Unique Member");

        // Find inputs across table and collapsed lists
        const nameInputs = container.querySelectorAll<HTMLInputElement>('input[type="text"]');
        expect(nameInputs.length).toBeGreaterThan(0);

        const activeOneInput = Array.from(nameInputs).find((i) => i.value === "Existing Active One");
        expect(activeOneInput).not.toBeUndefined();

        await act(async () => {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
            )?.set;
            nativeInputValueSetter?.call(activeOneInput, "Brand New Player Name");
            activeOneInput!.dispatchEvent(new Event("input", { bubbles: true }));
        });

        // Reclassified dynamically so now 2 unique new members can be imported!
        expect(container.textContent).toContain("Import 2 Unique Members");
    });

    it("preserves operator deselection on unrelated rows when a name is edited", async () => {
        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers: [],
                })
            );
        });

        const csvContent = `Player
New Candidate 1
New Candidate 2`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Initially both are selected -> Import 2 Unique Members
        expect(container.textContent).toContain("Import 2 Unique Members");

        // Manually deselect New Candidate 2
        const checkboxes = container.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]');
        expect(checkboxes.length).toBe(2);

        await act(async () => {
            checkboxes[1].click();
        });

        // Now 1 selected
        expect(container.textContent).toContain("Import 1 Unique Member");

        // Edit New Candidate 1's name
        const nameInputs = container.querySelectorAll<HTMLInputElement>('tbody input[type="text"]');
        await act(async () => {
            const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
                window.HTMLInputElement.prototype,
                "value"
            )?.set;
            nativeInputValueSetter?.call(nameInputs[0], "Renamed Candidate 1");
            nameInputs[0].dispatchEvent(new Event("input", { bubbles: true }));
        });

        // Candidate 2 remains deselected -> button still says Import 1 Unique Member!
        expect(container.textContent).toContain("Import 1 Unique Member");
    });

    it("excludes blank-name CSV rows from Select All and UI capacity consumption", async () => {
        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers: [],
                })
            );
        });

        const csvContent = `Player
New Candidate 1
   
New Candidate 2`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // 2 unique valid candidate members selectable (blank row excluded)
        expect(container.textContent).toContain("Import 2 Unique Members");

        // Toggle Select All off, then on
        const selectAllCheckbox = container.querySelector<HTMLInputElement>('thead input[type="checkbox"]');
        expect(selectAllCheckbox).not.toBeNull();

        await act(async () => {
            selectAllCheckbox!.click(); // Off
        });
        expect(container.textContent).toContain("Import 0 Unique Members");

        await act(async () => {
            selectAllCheckbox!.click(); // On
        });

        // Blank row must not be selected or consume UI capacity!
        expect(container.textContent).toContain("Import 2 Unique Members");
    });

    it("displays over-capacity warning when active count plus unique selections exceeds 100", async () => {
        const active99 = Array.from({ length: 99 }, (_, i) => ({
            id: `active-${i}`,
            playerName: `Active Member ${i + 1}`,
            archivedAt: null,
        }));

        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers: active99,
                })
            );
        });

        const csvContent = `Player
New Candidate 1
New Candidate 2
New Candidate 3`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Member Capacity Exceeded");
        expect(container.textContent).toContain("Your alliance has 99 active members, so you can add 1 more unique member");
        expect(container.textContent).toContain("Deselect 2 members to continue");

        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import")
        ) as HTMLButtonElement;

        expect(importBtn?.disabled).toBe(true);
    });

    it("stays on preview screen when server import action returns an error", async () => {
        (importMembers as ReturnType<typeof vi.fn>).mockResolvedValue({
            created: 0,
            restored: 0,
            skippedExisting: 0,
            skippedDuplicates: 0,
            skippedEmptyNames: 0,
            skippedUnselected: 0,
            errors: ["Your alliance has 100 active members"],
        });

        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers: [],
                })
            );
        });

        await act(async () => {
            fireFileUpload(`Player\nCandidate A`);
            await new Promise((r) => setTimeout(r, 50));
        });

        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import")
        ) as HTMLButtonElement;

        await act(async () => {
            importBtn.click();
        });

        // Error message displayed and form stays in preview mode (does not show "Import Complete")
        expect(mockRefresh).not.toHaveBeenCalled();
        expect(container.textContent).toContain("Your alliance has 100 active members");
        expect(container.textContent).not.toContain("Import Complete");
    });

    it("parses period-grouped THP like 450.000.000 and renders interpreted value, and blocks import when THP is invalid or negative", async () => {
        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers: [],
                })
            );
        });

        const csvContent = `Player,THP
Candidate A,450.000.000
Candidate B,-10`;

        await act(async () => {
            fireFileUpload(csvContent);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Candidate A shows "Interpreted: 450,000,000"
        expect(container.textContent).toContain("Interpreted: 450,000,000");

        // Candidate B has negative THP -> blocking error "Total Hero Power cannot be negative"
        expect(container.textContent).toContain("Total Hero Power cannot be negative");
        expect(container.textContent).toContain("Invalid THP Values Detected");

        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import")
        ) as HTMLButtonElement;

        expect(importBtn?.disabled).toBe(true);
    });

    it("displays sheet selector for multi-sheet workbooks and switches sheets cleanly", async () => {
        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers: [],
                })
            );
        });

        // Create multi-sheet XLSX workbook
        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet([["Player", "THP"], ["Alpha Member", "100000"]]);
        const ws2 = XLSX.utils.aoa_to_sheet([["Player", "THP"], ["Beta Member", "200000"]]);
        XLSX.utils.book_append_sheet(wb, ws1, "First Roster");
        XLSX.utils.book_append_sheet(wb, ws2, "Second Roster");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, undefined, "multi_roster.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        // Verify sheet selector renders sheet names
        expect(container.textContent).toContain("First Roster");
        expect(container.textContent).toContain("Second Roster");

        // First sheet is selected initially -> Alpha Member shown in input
        const initialInputs = container.querySelectorAll<HTMLInputElement>('input[type="text"]');
        const alphaInput = Array.from(initialInputs).find((i) => i.value === "Alpha Member");
        expect(alphaInput).not.toBeUndefined();

        // Click "Second Roster" sheet button
        const secondSheetBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Second Roster")
        ) as HTMLButtonElement;
        expect(secondSheetBtn).not.toBeUndefined();

        await act(async () => {
            secondSheetBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Second sheet is now selected -> Beta Member shown in input
        const switchedInputs = container.querySelectorAll<HTMLInputElement>('input[type="text"]');
        const betaInput = Array.from(switchedInputs).find((i) => i.value === "Beta Member");
        expect(betaInput).not.toBeUndefined();
    });

    it("clears parsed members and displays error when switching from a valid worksheet to an invalid worksheet", async () => {
        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers: [],
                })
            );
        });

        // Sheet 1 valid ("Player", "THP"), Sheet 2 invalid ("Notes", "Data" - no player column)
        const wb = XLSX.utils.book_new();
        const ws1 = XLSX.utils.aoa_to_sheet([["Player", "THP"], ["Valid Member", "100000"]]);
        const ws2 = XLSX.utils.aoa_to_sheet([["Notes", "Data"], ["Some note", "123"]]);
        XLSX.utils.book_append_sheet(wb, ws1, "Valid Sheet");
        XLSX.utils.book_append_sheet(wb, ws2, "Invalid Sheet");
        const xlsxBuf = XLSX.write(wb, { type: "array", bookType: "xlsx" });

        await act(async () => {
            fireFileUpload(xlsxBuf, undefined, "multi_roster.xlsx");
            await new Promise((r) => setTimeout(r, 50));
        });

        // Valid Sheet selected initially -> "Valid Member" visible in input
        const initialInputs = container.querySelectorAll<HTMLInputElement>('input[type="text"]');
        const validMemberInput = Array.from(initialInputs).find((i) => i.value === "Valid Member");
        expect(validMemberInput).not.toBeUndefined();

        // Click "Invalid Sheet"
        const invalidSheetBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Invalid Sheet")
        ) as HTMLButtonElement;
        expect(invalidSheetBtn).not.toBeUndefined();

        await act(async () => {
            invalidSheetBtn.click();
            await new Promise((r) => setTimeout(r, 50));
        });

        // Error message displayed and stale "Valid Member" cleared
        expect(container.textContent).toContain("No player column found");
        expect(container.textContent).not.toContain("Valid Member");

        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import")
        ) as HTMLButtonElement;
        expect(importBtn).toBeUndefined();
    });
});
