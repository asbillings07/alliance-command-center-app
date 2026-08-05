/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeAll, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom (as of this project's pinned version) doesn't implement <dialog>
// semantics at all — no `open` reflection, no showModal()/close(). Polyfill
// just enough of the real spec behavior for ConfirmDialog's own logic
// (pending/error/close wiring) to be testable: `open` reflects the
// attribute, showModal()/close() toggle it, and close() fires a real
// "close" event, matching browser behavior.
beforeAll(() => {
    const proto = HTMLDialogElement.prototype as unknown as {
        showModal: () => void;
        close: () => void;
    };
    const alreadyPolyfilled = HTMLDialogElement.prototype.hasOwnProperty("__ccPolyfilled");
    if (alreadyPolyfilled) return;

    Object.defineProperty(HTMLDialogElement.prototype, "open", {
        get(this: HTMLElement) {
            return this.hasAttribute("open");
        },
        set(this: HTMLElement, value: boolean) {
            if (value) {
                this.setAttribute("open", "");
            } else {
                this.removeAttribute("open");
            }
        },
        configurable: true,
    });

    proto.showModal = function (this: HTMLElement) {
        this.setAttribute("open", "");
    };

    proto.close = function (this: HTMLElement) {
        if (!this.hasAttribute("open")) return;
        this.removeAttribute("open");
        this.dispatchEvent(new Event("close"));
    };

    Object.defineProperty(HTMLDialogElement.prototype, "__ccPolyfilled", { value: true });
});

/**
 * Real browsers fire a cancelable "cancel" event on Escape and, unless
 * prevented, perform the default action of closing the dialog. jsdom
 * doesn't wire Escape to this at all, so tests simulate exactly that
 * contract directly.
 */
function simulateEscape(dialog: HTMLDialogElement): Event {
    const event = new Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    if (!event.defaultPrevented) {
        dialog.close();
    }
    return event;
}

let container: HTMLDivElement;
let root: Root;

async function mount(overrides: Partial<ConfirmDialogProps> = {}) {
    const onConfirm = overrides.onConfirm ?? vi.fn().mockResolvedValue(undefined);
    const onClose = overrides.onClose ?? vi.fn();
    const props: ConfirmDialogProps = {
        isOpen: true,
        title: "Archive 3 members?",
        confirmLabel: "Archive 3 members",
        confirmVariant: "warning",
        onConfirm,
        onClose,
        ...overrides,
    };

    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
        root.render(createElement(ConfirmDialog, props));
    });

    return { props, onConfirm, onClose };
}

function getDialog(): HTMLDialogElement {
    const dialog = container.querySelector("dialog");
    if (!dialog) throw new Error("dialog not rendered");
    return dialog;
}

function findButton(text: string | RegExp): HTMLButtonElement {
    const button = Array.from(container.querySelectorAll("button")).find((b) =>
        typeof text === "string" ? b.textContent === text : text.test(b.textContent ?? "")
    );
    if (!button) throw new Error(`button matching ${text} not found`);
    return button;
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
    });
}

afterEach(async () => {
    await act(async () => {
        root.unmount();
    });
    container.remove();
});

describe("ConfirmDialog", () => {
    it("calls showModal (via isOpen=true) so the dialog is open on mount", async () => {
        await mount({ isOpen: true });

        expect(getDialog().open).toBe(true);
    });

    it("does not open the dialog when isOpen is false", async () => {
        await mount({ isOpen: false });

        expect(getDialog().open).toBe(false);
    });

    it("renders the title and rich description content", async () => {
        await mount({
            title: "Archive 3 members?",
            description: createElement("ul", null, createElement("li", null, "They can be restored later.")),
        });

        expect(container.textContent).toContain("Archive 3 members?");
        expect(container.textContent).toContain("They can be restored later.");
    });

    it("closes and calls onClose when Cancel is clicked, without calling onConfirm", async () => {
        const onConfirm = vi.fn();
        const { onClose } = await mount({ onConfirm });

        await act(async () => {
            findButton("Cancel").click();
        });

        expect(onConfirm).not.toHaveBeenCalled();
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(getDialog().open).toBe(false);
    });

    it("closes and calls onClose after a successful confirm", async () => {
        const onConfirm = vi.fn().mockResolvedValue(undefined);
        const { onClose } = await mount({ onConfirm, confirmLabel: "Archive 3 members" });

        await act(async () => {
            findButton("Archive 3 members").click();
        });
        await flush();

        expect(onConfirm).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(getDialog().open).toBe(false);
    });

    it("keeps the dialog open and shows the error inline when onConfirm resolves an error, without calling onClose", async () => {
        const onConfirm = vi.fn().mockResolvedValue({ error: "Deselect 2 members to continue." });
        const { onClose } = await mount({ onConfirm, confirmLabel: "Restore 5 members" });

        await act(async () => {
            findButton("Restore 5 members").click();
        });
        await flush();

        expect(container.textContent).toContain("Deselect 2 members to continue.");
        expect(onClose).not.toHaveBeenCalled();
        expect(getDialog().open).toBe(true);
    });

    it("keeps the dialog open and shows a safe generic error, without calling onClose, when onConfirm rejects unexpectedly", async () => {
        // Distinct from the handled `{ error }` result above: this is an
        // onConfirm that *throws/rejects* (e.g. an unhandled network or
        // transaction failure the caller never mapped), not one that
        // resolved a domain-level rejection.
        const onConfirm = vi.fn().mockRejectedValue(new Error("ECONNRESET: socket hang up"));
        const { onClose } = await mount({ onConfirm, confirmLabel: "Archive 3 members" });

        await act(async () => {
            findButton("Archive 3 members").click();
        });
        await flush();

        expect(container.textContent).toContain("Something went wrong. Please try again.");
        // The raw exception message must never reach the user.
        expect(container.textContent).not.toContain("ECONNRESET");
        expect(onClose).not.toHaveBeenCalled();
        expect(getDialog().open).toBe(true);
        // isPending must be cleared so the user isn't stuck unable to retry or cancel.
        expect(findButton("Archive 3 members").disabled).toBe(false);
        expect(findButton("Cancel").disabled).toBe(false);
    });

    it("disables Cancel/Confirm and shows the pending label while onConfirm is in flight", async () => {
        let resolveConfirm!: (result: void) => void;
        const onConfirm = vi.fn().mockReturnValue(
            new Promise<void>((resolve) => {
                resolveConfirm = resolve;
            })
        );
        await mount({ onConfirm, confirmLabel: "Archive 3 members", pendingLabel: "Archiving…" });

        await act(async () => {
            findButton("Archive 3 members").click();
        });

        expect(findButton("Archiving…").disabled).toBe(true);
        expect(findButton("Cancel").disabled).toBe(true);

        await act(async () => {
            resolveConfirm();
        });
        await flush();
    });

    it("disables the confirm button when confirmDisabled is set, without blocking Cancel", async () => {
        await mount({ confirmDisabled: true, confirmLabel: "Restore 5 members" });

        expect(findButton("Restore 5 members").disabled).toBe(true);
        expect(findButton("Cancel").disabled).toBe(false);
    });

    it("allows Escape to close and call onClose when not pending", async () => {
        const { onClose } = await mount();

        await act(async () => {
            simulateEscape(getDialog());
        });

        expect(onClose).toHaveBeenCalledTimes(1);
        expect(getDialog().open).toBe(false);
    });

    it("blocks Escape while a confirm is pending, so the dialog stays open", async () => {
        let resolveConfirm!: (result: void) => void;
        const onConfirm = vi.fn().mockReturnValue(
            new Promise<void>((resolve) => {
                resolveConfirm = resolve;
            })
        );
        const { onClose } = await mount({ onConfirm, confirmLabel: "Archive 3 members" });

        await act(async () => {
            findButton("Archive 3 members").click();
        });

        let event!: Event;
        await act(async () => {
            event = simulateEscape(getDialog());
        });

        expect(event.defaultPrevented).toBe(true);
        expect(getDialog().open).toBe(true);
        expect(onClose).not.toHaveBeenCalled();

        await act(async () => {
            resolveConfirm();
        });
        await flush();
    });
});
