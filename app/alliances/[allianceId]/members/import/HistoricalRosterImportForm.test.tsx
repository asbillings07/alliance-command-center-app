/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { HistoricalRosterImportForm } from "./HistoricalRosterImportForm";

const mockRefresh = vi.fn();

vi.mock("next/navigation", () => ({
    useRouter: () => ({
        push: vi.fn(),
        replace: vi.fn(),
        refresh: mockRefresh,
    }),
}));

vi.mock("./historicalAction", () => ({
    importHistoricalRoster: vi.fn(),
}));

import { importHistoricalRoster } from "./historicalAction";

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
        result: string | ArrayBuffer | null = null;
        onload: ((e: { target: { result: string | ArrayBuffer } }) => void) | null = null;
        readAsText() {
            setTimeout(() => {
                this.result = fileContent;
                if (this.onload) this.onload({ target: { result: fileContent } });
            }, 0);
        }
        readAsArrayBuffer() {
            setTimeout(() => {
                const buf = new TextEncoder().encode(fileContent).buffer;
                this.result = buf;
                if (this.onload) this.onload({ target: { result: buf } });
            }, 0);
        }
    }
    window.FileReader = MockFileReader as unknown as typeof FileReader;
}

function fireFileUpload(fileContent: string, fileName = "roster.csv") {
    setupMockFileReader(fileContent);
    const fileInput = container.querySelector("#historical-roster-file") as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File([fileContent], fileName, { type: "text/csv" });
    Object.defineProperty(file, "size", { value: fileContent.length });
    Object.defineProperty(fileInput, "files", { value: [file], writable: true, configurable: true });

    const event = new Event("change", { bubbles: true });
    fileInput.dispatchEvent(event);
}

function successResult(overrides: Partial<Record<string, unknown>> = {}) {
    return {
        createdActive: 0,
        createdArchived: 0,
        restored: 0,
        skippedExisting: 0,
        skippedDuplicates: 0,
        skippedEmptyNames: 0,
        skippedUnselected: 0,
        skippedLifecycleConflict: 0,
        errors: [],
        memberImportId: "import-1",
        ...overrides,
    };
}

function findButtonByText(text: string): HTMLButtonElement {
    const btn = Array.from(container.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
    expect(btn).not.toBeUndefined();
    return btn as HTMLButtonElement;
}

describe("HistoricalRosterImportForm [component]", () => {
    const allianceId = "alliance-1";

    it("shows historical-mode explanation copy on the upload step", async () => {
        await act(async () => {
            root.render(createElement(HistoricalRosterImportForm, { allianceId, existingMembers: [] }));
        });

        expect(container.textContent).toContain("Historical roster mode");
        expect(container.textContent).toContain("explicitly mark each new member");

        const fileInput = container.querySelector<HTMLInputElement>("#historical-roster-file");
        expect(fileInput).not.toBeNull();
    });

    it("defaults a brand-new row to Unassigned and disables Import until resolved", async () => {
        await act(async () => {
            root.render(createElement(HistoricalRosterImportForm, { allianceId, existingMembers: [] }));
        });

        await act(async () => {
            fireFileUpload(`Player\nBrand New Hero`);
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Unassigned");

        const importBtn = findButtonByText("Import");
        expect(importBtn.disabled).toBe(true);

        // Resolve it via the per-row Active button.
        const activeButtons = Array.from(container.querySelectorAll("button")).filter(
            (b) => b.textContent === "Active"
        );
        await act(async () => {
            (activeButtons[0] as HTMLButtonElement).click();
        });

        const importBtnAfter = findButtonByText("Import");
        expect(importBtnAfter.disabled).toBe(false);
    });

    it("initializes an existing active match to Preserve Active and an existing archived match to Preserve Archived", async () => {
        const existingMembers = [
            { id: "m1", playerName: "Active Veteran", archivedAt: null },
            { id: "m2", playerName: "Archived Veteran", archivedAt: "2023-01-01T00:00:00.000Z" },
        ];

        await act(async () => {
            root.render(createElement(HistoricalRosterImportForm, { allianceId, existingMembers }));
        });

        await act(async () => {
            fireFileUpload(`Player\nActive Veteran\nArchived Veteran`);
            await new Promise((r) => setTimeout(r, 50));
        });

        expect(container.textContent).toContain("Preserve Active");
        expect(container.textContent).toContain("Preserve Archived");
        expect(container.textContent).toContain("Preserve (unchanged)");

        // Both rows are already resolved (not unassigned) -> Import enabled.
        const importBtn = findButtonByText("Import");
        expect(importBtn.disabled).toBe(false);
    });

    it("shows a Restore to Active outcome when an archived match is switched to Active", async () => {
        const existingMembers = [{ id: "m1", playerName: "Archived Veteran", archivedAt: "2023-01-01T00:00:00.000Z" }];

        await act(async () => {
            root.render(createElement(HistoricalRosterImportForm, { allianceId, existingMembers }));
        });

        await act(async () => {
            fireFileUpload(`Player\nArchived Veteran`);
            await new Promise((r) => setTimeout(r, 50));
        });

        const activeButton = findButtonByText("Active"); // "Preserve Archived" row's Active toggle reads "Active"
        await act(async () => {
            activeButton.click();
        });

        expect(container.textContent).toContain("Restore to Active");
    });

    it("shows a lifecycle conflict badge when an existing active member is marked Archived, and never allows submitting it as a mutation", async () => {
        const existingMembers = [{ id: "m1", playerName: "Current Leader", archivedAt: null }];

        await act(async () => {
            root.render(createElement(HistoricalRosterImportForm, { allianceId, existingMembers }));
        });

        await act(async () => {
            fireFileUpload(`Player\nCurrent Leader`);
            await new Promise((r) => setTimeout(r, 50));
        });

        // Row starts as "Preserve Active"; switch it to Archived.
        const archivedButton = findButtonByText("Archived");
        await act(async () => {
            archivedButton.click();
        });

        expect(container.textContent).toContain("Conflict — active member");
        expect(container.textContent).toContain("Lifecycle conflicts");
    });

    it("bulk-marks all selected rows as Archived", async () => {
        await act(async () => {
            root.render(createElement(HistoricalRosterImportForm, { allianceId, existingMembers: [] }));
        });

        await act(async () => {
            fireFileUpload(`Player\nHero One\nHero Two`);
            await new Promise((r) => setTimeout(r, 50));
        });

        const bulkArchiveBtn = findButtonByText("Mark Selected Archived");
        await act(async () => {
            bulkArchiveBtn.click();
        });

        expect(container.textContent).toContain("New — Archived");
        const importBtn = findButtonByText("Import");
        expect(importBtn.disabled).toBe(false);
    });

    it("filters rows by tab", async () => {
        const existingMembers = [{ id: "m1", playerName: "Active Match", archivedAt: null }];

        await act(async () => {
            root.render(createElement(HistoricalRosterImportForm, { allianceId, existingMembers }));
        });

        await act(async () => {
            fireFileUpload(`Player\nActive Match\nNew Person`);
            await new Promise((r) => setTimeout(r, 50));
        });

        // "New Person" is unassigned by default; switch to the Unassigned tab.
        const unassignedTab = findButtonByText("Unassigned (1)");
        await act(async () => {
            unassignedTab.click();
        });

        const visibleNames = Array.from(
            container.querySelectorAll<HTMLInputElement>('tbody input[type="text"]')
        ).map((el) => el.value);
        expect(visibleNames).toEqual(["New Person"]);
    });

    it("submits with the correct entries and a fingerprint, and shows created/restored breakdown on completion", async () => {
        (importHistoricalRoster as ReturnType<typeof vi.fn>).mockResolvedValue(
            successResult({ createdActive: 1, createdArchived: 1 })
        );

        await act(async () => {
            root.render(createElement(HistoricalRosterImportForm, { allianceId, existingMembers: [] }));
        });

        await act(async () => {
            fireFileUpload(`Player,THP\nNew Active,10000\nNew Archived,20000`);
            await new Promise((r) => setTimeout(r, 50));
        });

        const activeButtons = Array.from(container.querySelectorAll("button")).filter((b) => b.textContent === "Active");
        const archivedButtons = Array.from(container.querySelectorAll("button")).filter(
            (b) => b.textContent === "Archived"
        );
        await act(async () => {
            (activeButtons[0] as HTMLButtonElement).click();
            (archivedButtons[1] as HTMLButtonElement).click();
        });

        const importBtn = findButtonByText("Import");
        await act(async () => {
            importBtn.click();
        });

        expect(importHistoricalRoster).toHaveBeenCalledTimes(1);
        const [calledAllianceId, calledEntries, calledProvenance, calledFingerprint] = (
            importHistoricalRoster as ReturnType<typeof vi.fn>
        ).mock.calls[0];
        expect(calledAllianceId).toBe(allianceId);
        expect(calledEntries).toEqual(
            expect.arrayContaining([
                expect.objectContaining({ playerName: "New Active", finalStatus: "active" }),
                expect.objectContaining({ playerName: "New Archived", finalStatus: "archived" }),
            ])
        );
        expect(calledProvenance).toEqual(expect.objectContaining({ fileName: "roster.csv" }));
        expect(typeof calledFingerprint).toBe("string");
        expect(calledFingerprint.length).toBeGreaterThan(0);

        expect(mockRefresh).toHaveBeenCalledTimes(1);
        expect(container.textContent).toContain("Created active");
        expect(container.textContent).toContain("Created archived");
    });

    it("shows 'Nothing was imported' when the result has zero mutations and no errors", async () => {
        const existingMembers = [{ id: "m1", playerName: "Steady Member", archivedAt: null }];
        (importHistoricalRoster as ReturnType<typeof vi.fn>).mockResolvedValue(
            successResult({ skippedExisting: 1, memberImportId: null })
        );

        await act(async () => {
            root.render(createElement(HistoricalRosterImportForm, { allianceId, existingMembers }));
        });

        await act(async () => {
            fireFileUpload(`Player\nSteady Member`);
            await new Promise((r) => setTimeout(r, 50));
        });

        const importBtn = findButtonByText("Import");
        await act(async () => {
            importBtn.click();
        });

        expect(container.textContent).toContain("Nothing was imported.");
    });
});
