/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { RosterImportForm } from "./RosterImportForm";

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

function setupMockFileReader(fileContent: string) {
    class MockFileReader {
        onload: ((e: { target: { result: string } }) => void) | null = null;
        readAsText() {
            setTimeout(() => {
                if (this.onload) {
                    this.onload({ target: { result: fileContent } });
                }
            }, 0);
        }
    }
    window.FileReader = MockFileReader as unknown as typeof FileReader;
}

function fireFileUpload(fileContent: string) {
    setupMockFileReader(fileContent);
    const fileInput = container.querySelector("#roster-file") as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File([fileContent], "roster.csv", { type: "text/csv" });

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

    it("parses CSV, highlights duplicate rows, and deselects duplicates by default", async () => {
        await act(async () => {
            root.render(
                createElement(RosterImportForm, {
                    allianceId,
                    existingMembers,
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
        expect(container.textContent).toContain("1 Duplicate Row Highlighted in CSV");
        expect(container.textContent).toContain("Duplicate in CSV");

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

        // Verify import button shows unique count
        const importBtn = Array.from(container.querySelectorAll("button")).find((b) =>
            b.textContent?.includes("Import")
        );
        expect(importBtn).not.toBeUndefined();
        expect(importBtn?.textContent).toContain("Import 2 Unique Members");
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

        expect(container.textContent).toContain("Roster Capacity Exceeded");
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
        expect(container.textContent).toContain("Your alliance has 100 active members");
        expect(container.textContent).not.toContain("Import Complete");
    });
});
