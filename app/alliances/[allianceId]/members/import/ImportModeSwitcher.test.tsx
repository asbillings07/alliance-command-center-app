/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ImportModeSwitcher } from "./ImportModeSwitcher";

vi.mock("next/navigation", () => ({
    useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("@/app/src/components/client", () => ({
    TourButton: () => createElement("button", null, "Tour"),
}));

vi.mock("./action", () => ({ importMembers: vi.fn() }));
vi.mock("./historicalAction", () => ({ importHistoricalRoster: vi.fn() }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
});

describe("ImportModeSwitcher [component]", () => {
    const allianceId = "alliance-1";

    it("defaults to Current Roster and hides the Historical Roster tab without canManageMembers", async () => {
        await act(async () => {
            root.render(
                createElement(ImportModeSwitcher, {
                    allianceId,
                    existingMembers: [],
                    canManageMembers: false,
                })
            );
        });

        expect(container.textContent).toContain("Current Roster");
        expect(container.textContent).not.toContain("Historical Roster");
        // Current-roster form's upload copy should be showing by default.
        expect(container.textContent).toContain("Scope: Alliance Members");
    });

    it("shows the Historical Roster tab with canManageMembers and switches forms on click", async () => {
        await act(async () => {
            root.render(
                createElement(ImportModeSwitcher, {
                    allianceId,
                    existingMembers: [],
                    canManageMembers: true,
                })
            );
        });

        expect(container.textContent).toContain("Historical Roster");

        const historicalButton = Array.from(container.querySelectorAll("button")).find((el) =>
            el.textContent?.includes("Historical Roster")
        ) as HTMLButtonElement;
        // Plain toggle button, not a fake ARIA tab (#282 follow-up) —
        // `aria-pressed` communicates which mode is active without the
        // roving-tabindex/arrow-key machinery a real tablist would require.
        expect(historicalButton.getAttribute("aria-pressed")).toBe("false");

        await act(async () => {
            historicalButton.click();
        });

        expect(historicalButton.getAttribute("aria-pressed")).toBe("true");
        expect(container.textContent).toContain("Historical roster mode");
        expect(container.textContent).not.toContain("Scope: Alliance Members");
    });
});
