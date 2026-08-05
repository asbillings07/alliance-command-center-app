/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("next/link", () => ({
    default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
        React.createElement("a", { href, ...props }, children),
}));

// Same established workaround as AccessRequestActionsPanel.test.tsx /
// BetaWaveSelect.test.tsx: importing anything from the real
// "@/app/src/components/client" barrel eagerly evaluates every re-exported
// module in it (including auth-adjacent components), which drags in
// next-auth -> next/server and breaks under Vitest's Node module resolution.
// ConfirmDialog's own open/close/pending/error/focus semantics are already
// fully covered by ConfirmDialog.test.tsx — this stand-in only needs to
// prove MembersTable wires the right props and reacts correctly to the
// onConfirm contract.
vi.mock("@/app/src/components/client", () => {
    function Button({
        children,
        loading,
        disabled,
        ...props
    }: React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }) {
        return React.createElement(
            "button",
            { ...props, disabled: disabled || loading, "aria-busy": loading },
            children
        );
    }

    function ConfirmDialog({
        isOpen,
        title,
        description,
        confirmLabel,
        cancelLabel = "Cancel",
        confirmDisabled,
        onConfirm,
        onClose,
    }: {
        isOpen: boolean;
        title: string;
        description?: React.ReactNode;
        confirmLabel: string;
        cancelLabel?: string;
        confirmDisabled?: boolean;
        onConfirm: () => Promise<{ error?: string } | void>;
        onClose: () => void;
    }) {
        const [error, setError] = React.useState<string | null>(null);
        if (!isOpen) return null;

        return React.createElement(
            "div",
            { "data-testid": "confirm-dialog" },
            React.createElement("h2", null, title),
            description,
            error && React.createElement("p", { role: "alert" }, error),
            React.createElement(Button, { onClick: () => onClose() }, cancelLabel),
            React.createElement(
                Button,
                {
                    disabled: confirmDisabled,
                    onClick: async () => {
                        setError(null);
                        const result = await onConfirm();
                        if (result && "error" in result && result.error) {
                            setError(result.error);
                        } else {
                            onClose();
                        }
                    },
                },
                confirmLabel
            )
        );
    }

    return { Button, ConfirmDialog };
});

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
    useRouter: () => ({ refresh: mockRefresh }),
}));

const mockBulkArchive = vi.fn();
const mockBulkRestore = vi.fn();
vi.mock("./bulk-actions", () => ({
    bulkArchiveMembers: (...args: unknown[]) => mockBulkArchive(...args),
    bulkRestoreMembers: (...args: unknown[]) => mockBulkRestore(...args),
}));

// Belt-and-suspenders: "./bulk-actions" above is mocked so its real body
// (and this transitive next-auth -> next/server chain) shouldn't load, but
// mock it directly too in case anything else in the tree ever imports it.
vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn(),
}));

import { MembersTable, type MembersTableMember, type MembersTableProps } from "./MembersTable";

let container: HTMLDivElement;
let root: Root;

function buildMember(overrides: Partial<MembersTableMember> = {}): MembersTableMember {
    return {
        id: "mem_1",
        playerName: "Dragon",
        archivedAt: null,
        thp: null,
        squadPower: null,
        role: null,
        ...overrides,
    };
}

async function mount(overrides: Partial<MembersTableProps> = {}) {
    const props: MembersTableProps = {
        allianceId: "all_1",
        filter: "active",
        members: [buildMember()],
        periodMetricColumns: [],
        metricValues: {},
        canManageMembers: true,
        activeCount: 1,
        ...overrides,
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root.render(createElement(MembersTable, props));
    });

    return props;
}

function checkboxes(): HTMLInputElement[] {
    return Array.from(container.querySelectorAll('input[type="checkbox"]'));
}

function findButton(text: string | RegExp): HTMLButtonElement | undefined {
    return Array.from(container.querySelectorAll("button")).find((b) =>
        typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")
    );
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

/** Re-renders into the *same* root/container (no new mount) — simulates the
 * parent Server Component re-rendering this same component instance with
 * new props after router.refresh(), without unmounting it. */
async function rerender(props: MembersTableProps) {
    await act(async () => {
        root.render(createElement(MembersTable, props));
    });
}

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
});

describe("MembersTable — selection visibility per view", () => {
    it("renders no checkboxes when the caller cannot manage members", async () => {
        await mount({ canManageMembers: false });

        expect(checkboxes()).toHaveLength(0);
    });

    it("renders no checkboxes on the All view even for a manager (browse-only)", async () => {
        await mount({ filter: "all", canManageMembers: true });

        expect(checkboxes()).toHaveLength(0);
    });

    it("renders one checkbox per row plus a select-all checkbox on the Active view for a manager", async () => {
        await mount({
            filter: "active",
            members: [buildMember({ id: "m1" }), buildMember({ id: "m2", playerName: "Phoenix" })],
        });

        // 2 rows + 1 select-all header checkbox
        expect(checkboxes()).toHaveLength(3);
    });
});

describe("MembersTable — bulk bar", () => {
    it("shows no bulk bar until at least one row is selected", async () => {
        await mount();

        expect(container.textContent).not.toContain("selected");
    });

    it("shows Archive selected on the Active view once a row is selected", async () => {
        await mount({ filter: "active" });

        await act(async () => {
            checkboxes()[1].click(); // index 0 is select-all
        });

        expect(container.textContent).toContain("1 member selected");
        expect(findButton("Archive selected")).toBeDefined();
    });

    it("shows Restore selected on the Archived view once a row is selected", async () => {
        await mount({ filter: "archived", members: [buildMember({ archivedAt: new Date() })] });

        await act(async () => {
            checkboxes()[1].click();
        });

        expect(findButton("Restore selected")).toBeDefined();
    });

    it("select-all selects every displayed row and toggling it off clears the selection", async () => {
        await mount({
            filter: "active",
            members: [buildMember({ id: "m1" }), buildMember({ id: "m2", playerName: "Phoenix" })],
        });

        await act(async () => {
            checkboxes()[0].click(); // select-all
        });
        expect(container.textContent).toContain("2 members selected");

        await act(async () => {
            checkboxes()[0].click();
        });
        expect(container.textContent).not.toContain("selected");
    });

    it("Clear resets the selection without opening the dialog", async () => {
        await mount();

        await act(async () => {
            checkboxes()[1].click();
        });
        await act(async () => {
            findButton("Clear")!.click();
        });

        expect(container.textContent).not.toContain("selected");
    });
});

describe("MembersTable — archive confirmation flow", () => {
    it("opens the dialog with the archive copy and selected names when Archive selected is clicked", async () => {
        await mount({ filter: "active", members: [buildMember({ playerName: "Dragon" })] });

        await act(async () => {
            checkboxes()[1].click();
        });
        await act(async () => {
            findButton("Archive selected")!.click();
        });

        expect(container.textContent).toContain("Archive 1 member?");
        expect(container.textContent).toContain("They will leave the active roster.");
        expect(container.textContent).toContain(
            "Metrics, notes, invitations, linked accounts, and history will be preserved."
        );
        expect(container.textContent).toContain("They can be restored later.");
        expect(container.textContent).toContain("Dragon");
    });

    it("calls bulkArchiveMembers with the selected member ids and shows an honest result summary on success", async () => {
        mockBulkArchive.mockResolvedValue({ success: true, archivedCount: 1, skippedCount: 0 });
        await mount({
            filter: "active",
            members: [buildMember({ id: "m1", playerName: "Dragon" })],
        });

        await act(async () => {
            checkboxes()[1].click();
        });
        await act(async () => {
            findButton("Archive selected")!.click();
        });
        await act(async () => {
            findButton("Archive 1 member")!.click();
        });
        await flush();

        const [formData] = mockBulkArchive.mock.calls[0] as [FormData];
        expect(formData.get("allianceId")).toBe("all_1");
        expect(formData.getAll("memberId")).toEqual(["m1"]);
        expect(container.textContent).toContain("Archived 1 member.");
        expect(mockRefresh).toHaveBeenCalledTimes(1);
        // Selection is cleared after a successful action.
        expect(container.textContent).not.toContain("1 member selected");
    });

    it("reports skipped members honestly when some were already archived", async () => {
        mockBulkArchive.mockResolvedValue({ success: true, archivedCount: 1, skippedCount: 1 });
        await mount({
            filter: "active",
            members: [buildMember({ id: "m1" }), buildMember({ id: "m2", playerName: "Phoenix" })],
        });

        await act(async () => {
            checkboxes()[0].click(); // select all
        });
        await act(async () => {
            findButton("Archive selected")!.click();
        });
        await act(async () => {
            findButton(/^Archive 2 members$/)!.click();
        });
        await flush();

        expect(container.textContent).toContain(
            "Archived 1 member. 1 member was already archived and skipped."
        );
    });

    it("keeps the dialog open with an inline error when the server rejects the bulk archive", async () => {
        mockBulkArchive.mockResolvedValue({ success: false, error: "You don't have permission to archive members" });
        await mount({ filter: "active" });

        await act(async () => {
            checkboxes()[1].click();
        });
        await act(async () => {
            findButton("Archive selected")!.click();
        });
        await act(async () => {
            findButton("Archive 1 member")!.click();
        });
        await flush();

        expect(container.textContent).toContain("You don't have permission to archive members");
        expect(mockRefresh).not.toHaveBeenCalled();
    });
});

describe("MembersTable — result summary survives the view going empty", () => {
    it("keeps showing the archive result summary after a refresh empties the Active view, rendering the caller's emptyState instead of the table", async () => {
        mockBulkArchive.mockResolvedValue({ success: true, archivedCount: 1, skippedCount: 0 });
        const baseProps: MembersTableProps = {
            allianceId: "all_1",
            filter: "active",
            members: [buildMember({ id: "m1", playerName: "LastActiveMember" })],
            periodMetricColumns: [],
            metricValues: {},
            canManageMembers: true,
            activeCount: 1,
            emptyState: createElement("div", { "data-testid": "empty-state" }, "No active members yet"),
        };
        await mount(baseProps);

        await act(async () => {
            checkboxes()[1].click();
        });
        await act(async () => {
            findButton("Archive selected")!.click();
        });
        await act(async () => {
            findButton("Archive 1 member")!.click();
        });
        await flush();

        expect(container.textContent).toContain("Archived 1 member.");
        expect(mockRefresh).toHaveBeenCalledTimes(1);

        // Simulate what router.refresh() actually does here: the parent
        // Server Component re-renders this same MembersTable instance with
        // the now-empty roster — it must NOT unmount MembersTable (that
        // would wipe the resultSummary state along with it).
        await rerender({ ...baseProps, members: [] });

        expect(container.textContent).toContain("Archived 1 member.");
        expect(container.querySelector('[data-testid="empty-state"]')).not.toBeNull();
        expect(container.textContent).toContain("No active members yet");
    });
});

describe("MembersTable — restore confirmation flow", () => {
    it("shows the capacity math instead of the archive bullets", async () => {
        await mount({
            filter: "archived",
            members: [buildMember({ archivedAt: new Date() })],
            activeCount: 91,
        });

        await act(async () => {
            checkboxes()[1].click();
        });
        await act(async () => {
            findButton("Restore selected")!.click();
        });

        expect(container.textContent).toContain("Restore 1 member?");
        expect(container.textContent).toContain("Active roster: 91 → 92; 8 spaces remaining.");
        expect(container.textContent).not.toContain("They will leave the active roster.");
    });

    it("matches the PR2 contract example exactly: 7 selected, 91 -> 98, 2 remaining", async () => {
        const members = Array.from({ length: 7 }, (_, i) =>
            buildMember({ id: `m${i}`, playerName: `Member ${i}`, archivedAt: new Date() })
        );
        await mount({ filter: "archived", members, activeCount: 91 });

        await act(async () => {
            checkboxes()[0].click(); // select all 7
        });
        await act(async () => {
            findButton("Restore selected")!.click();
        });

        expect(container.textContent).toContain("Restore 7 members?");
        expect(container.textContent).toContain("Active roster: 91 → 98; 2 spaces remaining.");
    });

    it("disables confirm and shows the capacity error when the selection exceeds available capacity", async () => {
        const members = Array.from({ length: 5 }, (_, i) =>
            buildMember({ id: `m${i}`, playerName: `Member ${i}`, archivedAt: new Date() })
        );
        // 97 active -> only 3 spaces remain for a 5-member restore.
        await mount({ filter: "archived", members, activeCount: 97 });

        await act(async () => {
            checkboxes()[0].click();
        });
        await act(async () => {
            findButton("Restore selected")!.click();
        });

        expect(container.textContent).toContain(
            "Your alliance has 97 active members, so you can restore 3 more."
        );
        expect(findButton(/^Restore 5 members$/)!.disabled).toBe(true);
        expect(mockBulkRestore).not.toHaveBeenCalled();
    });

    it("calls bulkRestoreMembers and shows the result summary on success", async () => {
        mockBulkRestore.mockResolvedValue({ success: true, restoredCount: 1, skippedCount: 0 });
        await mount({
            filter: "archived",
            members: [buildMember({ id: "m1", archivedAt: new Date() })],
            activeCount: 5,
        });

        await act(async () => {
            checkboxes()[1].click();
        });
        await act(async () => {
            findButton("Restore selected")!.click();
        });
        await act(async () => {
            findButton("Restore 1 member")!.click();
        });
        await flush();

        const [formData] = mockBulkRestore.mock.calls[0] as [FormData];
        expect(formData.getAll("memberId")).toEqual(["m1"]);
        expect(container.textContent).toContain("Restored 1 member.");
        expect(mockRefresh).toHaveBeenCalledTimes(1);
    });
});
