/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportForm } from "./ImportForm";

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
    const fileInput = container.querySelector("#csv-upload") as HTMLInputElement;
    expect(fileInput).not.toBeNull();

    const file = new File([fileContent], "results.csv", { type: "text/csv" });
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
        expect(fileInput?.getAttribute("aria-label")).toContain("Upload CSV spreadsheet (.csv)");
    });

    it("completes import flow with outcome-based success terminology and destination period context", async () => {
        (importMemberMetrics as ReturnType<typeof vi.fn>).mockResolvedValue({
            perMetric: [{ metricId: "met1", name: "Kill Points", count: 2 }],
            totalCount: 2,
            created: [],
            attached: [],
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
        expect(container.textContent).toContain("Evaluation Results Imported");
        expect(container.textContent).toContain("Evaluation results have been recorded into destination period 'Week 28 Evaluation'.");
        expect(container.textContent).toContain("Import More Results");
    });
});
