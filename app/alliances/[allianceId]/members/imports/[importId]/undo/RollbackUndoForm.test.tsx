/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import React, { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// Same established workaround as MembersTable.test.tsx: importing anything
// from the real "@/app/src/components/client" barrel eagerly evaluates
// every re-exported module in it (including auth-adjacent components),
// dragging in next-auth -> next/server, which breaks under Vitest's Node
// module resolution. ConfirmDialog's own semantics are already fully
// covered by ConfirmDialog.test.tsx — this stand-in only needs to prove
// RollbackUndoForm wires the right props and reacts correctly to the
// onConfirm contract.
vi.mock("@/app/src/components/client", () => {
    const Button = React.forwardRef<
        HTMLButtonElement,
        React.ButtonHTMLAttributes<HTMLButtonElement> & { loading?: boolean }
    >(function Button({ children, loading, disabled, ...props }, ref) {
        return React.createElement(
            "button",
            { ...props, ref, disabled: disabled || loading, "aria-busy": loading },
            children
        );
    });

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

const mockRollbackImport = vi.fn();
vi.mock("./action", () => ({
    rollbackImport: (...args: unknown[]) => mockRollbackImport(...args),
}));

import { RollbackUndoForm, type RollbackUndoFormProps } from "./RollbackUndoForm";
import type { RollbackPreviewItem } from "../rollbackPreview";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
});

async function mount(items: RollbackPreviewItem[]) {
    const props: RollbackUndoFormProps = {
        allianceId: "alliance-1",
        importId: "import-1",
        items,
        previewFingerprint: "fingerprint-1",
    };
    await act(async () => {
        root.render(createElement(RollbackUndoForm, props));
    });
    return { props };
}

function findButton(name: string | RegExp): HTMLButtonElement {
    const buttons = Array.from(container.querySelectorAll("button"));
    const match = buttons.find((b) => (typeof name === "string" ? b.textContent === name : name.test(b.textContent ?? "")));
    if (!match) throw new Error(`Button not found: ${name}`);
    return match as HTMLButtonElement;
}

function findRadio(name: string): HTMLInputElement {
    const el = container.querySelector(`input[type="radio"][value="${name}"]`);
    if (!el) throw new Error(`Radio not found: ${name}`);
    return el as HTMLInputElement;
}

function findAllRadios(): HTMLInputElement[] {
    return Array.from(container.querySelectorAll('input[type="radio"]'));
}

function buildItem(overrides: Partial<RollbackPreviewItem> = {}): RollbackPreviewItem {
    return {
        changeId: "change-1",
        playerNameSnapshot: "Alice",
        sourceRow: 1,
        changeType: "CREATED",
        allianceMemberId: "member-1",
        currentlyArchived: false,
        hasConflict: false,
        driftedFields: [],
        hadLaterImportInvolvement: false,
        hadLinkedUser: false,
        metricEntryCount: 0,
        leadershipNoteCount: 0,
        invitationCount: 0,
        requiresResolution: false,
        defaultResolution: "DELETED",
        ...overrides,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
}

describe("RollbackUndoForm", () => {
    it("renders a clean row's default action with no radios and an enabled confirm button", async () => {
        await mount([buildItem()]);

        expect(container.textContent).toContain("Delete (undo creation)");
        expect(findAllRadios()).toHaveLength(0);
        expect(findButton("Undo this import").disabled).toBe(false);
    });

    it("pluralizes an irregular noun correctly in the conflict reasons list ('entries', not 'entrys')", async () => {
        await mount([
            buildItem({
                requiresResolution: true,
                defaultResolution: null,
                hasConflict: true,
                metricEntryCount: 2,
            }),
        ]);

        expect(container.textContent).toContain("2 metric entries recorded since");
        expect(container.textContent).not.toContain("entrys");
    });

    it("shows no preselection for an actionable conflict, and disables confirm until it's explicitly resolved", async () => {
        await mount([buildItem({ requiresResolution: true, defaultResolution: null, hasConflict: true })]);

        const keepActive = findRadio("RETAIN_ACTIVE");
        const archive = findRadio("ARCHIVE_PRESERVING_HISTORY");
        expect(keepActive.checked).toBe(false);
        expect(archive.checked).toBe(false);
        expect(findButton("Undo this import").disabled).toBe(true);
    });

    it("enables confirm only once every actionable conflict has an explicit choice", async () => {
        await mount([
            buildItem({
                changeId: "change-1",
                requiresResolution: true,
                defaultResolution: null,
                hasConflict: true,
            }),
            buildItem({
                changeId: "change-2",
                playerNameSnapshot: "Bob",
                requiresResolution: true,
                defaultResolution: null,
                hasConflict: true,
            }),
        ]);

        expect(findButton("Undo this import").disabled).toBe(true);

        await act(async () => {
            findAllRadios()
                .filter((r) => r.value === "RETAIN_ACTIVE")[0]
                .click();
        });
        // Only one of the two conflicts resolved so far.
        expect(findButton("Undo this import").disabled).toBe(true);

        await act(async () => {
            findAllRadios()
                .filter((r) => r.value === "ARCHIVE_PRESERVING_HISTORY")[1]
                .click();
        });
        expect(findButton("Undo this import").disabled).toBe(false);
    });

    it("submits resolution:<changeId> form fields matching the owner's explicit choices, and shows the result summary on success", async () => {
        mockRollbackImport.mockResolvedValue({
            success: true,
            outcome: "ROLLED_BACK_WITH_RETAINED_MEMBERS",
            deletedCount: 0,
            revertedCount: 0,
            retainedActiveCount: 0,
            archivedPreservingHistoryCount: 1,
            retainedArchivedCount: 0,
            skippedConflictCount: 0,
        });

        await mount([
            buildItem({ requiresResolution: true, defaultResolution: null, hasConflict: true }),
        ]);

        await act(async () => {
            findRadio("ARCHIVE_PRESERVING_HISTORY").click();
        });
        await act(async () => {
            findButton("Undo this import").click();
        });
        await act(async () => {
            findButton("Undo import").click();
        });

        expect(mockRollbackImport).toHaveBeenCalledTimes(1);
        const submittedFormData = mockRollbackImport.mock.calls[0][0] as FormData;
        expect(submittedFormData.get("allianceId")).toBe("alliance-1");
        expect(submittedFormData.get("importId")).toBe("import-1");
        expect(submittedFormData.get("previewFingerprint")).toBe("fingerprint-1");
        expect(submittedFormData.get("resolution:change-1")).toBe("ARCHIVE_PRESERVING_HISTORY");

        expect(container.textContent).toContain("undone, but some members were retained");
        expect(container.textContent).toContain("1 member archived");
        expect(mockRefresh).toHaveBeenCalledTimes(1);
    });

    it("surfaces a server-side rejection inline via the confirm dialog instead of losing it", async () => {
        mockRollbackImport.mockResolvedValue({
            success: false,
            error: "This import's state changed since you loaded this page. Review the updated preview and try again.",
        });

        await mount([buildItem()]);

        await act(async () => {
            findButton("Undo this import").click();
        });
        await act(async () => {
            findButton("Undo import").click();
        });

        expect(container.textContent).toContain("This import's state changed since you loaded this page");
        expect(mockRefresh).not.toHaveBeenCalled();
    });
});
