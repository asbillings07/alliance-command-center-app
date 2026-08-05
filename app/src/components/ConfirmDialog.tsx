"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, type ButtonVariant } from "./Button";

export type ConfirmDialogResult = { error?: string } | void;

export type ConfirmDialogProps = {
    /**
     * Controls whether the dialog is shown. The `<dialog>` node is always
     * mounted; this effect-driven prop just calls `showModal()`/`close()` on
     * it, which is what gives it native top-layer stacking, `::backdrop`
     * styling, Escape-to-cancel, and focus containment/return for free.
     */
    isOpen: boolean;
    title: string;
    /**
     * Rich body content — bullet lists, capacity math, selected-name
     * previews, etc. The caller owns its semantics (e.g. a real `<ul>` for
     * bullet points).
     */
    description?: ReactNode;
    confirmLabel: string;
    pendingLabel?: string;
    cancelLabel?: string;
    /** Button color for the confirm action. Defaults to "primary". */
    confirmVariant?: ButtonVariant;
    /**
     * Disables the confirm button (e.g. a known-upfront capacity shortfall)
     * without blocking Cancel/Escape — used for client-side pre-flight
     * validation, distinct from a server-side rejection surfaced via the
     * `{ error }` return from `onConfirm`.
     */
    confirmDisabled?: boolean;
    /**
     * Called when the user clicks confirm. Return `{ error }` to keep the
     * dialog open and show the error inline (e.g. a server-side rejection
     * discovered only inside the transaction); return nothing/undefined on
     * success and the dialog closes itself.
     */
    onConfirm: () => Promise<ConfirmDialogResult>;
    /** Called whenever the dialog closes, via any path (Cancel, Escape, or a successful confirm). */
    onClose: () => void;
};

/**
 * Reusable confirmation dialog (#277 PR 2) backed by the native `<dialog>`
 * element, matching the pattern already established in PeriodMetricForm.tsx
 * — `showModal()` gets Escape-to-cancel, focus containment, and
 * return-focus-to-trigger for free from the browser, so this component only
 * has to own pending/error state and button wiring.
 */
export function ConfirmDialog({
    isOpen,
    title,
    description,
    confirmLabel,
    pendingLabel = "Working…",
    cancelLabel = "Cancel",
    confirmVariant = "primary",
    confirmDisabled = false,
    onConfirm,
    onClose,
}: ConfirmDialogProps) {
    const dialogRef = useRef<HTMLDialogElement>(null);
    const [isPending, setIsPending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const titleId = useId();
    const descriptionId = useId();
    /**
     * Identity of the confirm attempt currently "owned" by this open dialog.
     * The <dialog> node stays mounted across opens/closes (see the isOpen
     * doc comment above), and the explicitly supported force-close/reopen
     * path can leave a previous onConfirm() promise genuinely still in
     * flight when the dialog reopens. Every reopen and every new confirm
     * click bumps this ref; handleConfirmClick captures its value up front
     * and re-checks it after every await, so a late result/finalizer from a
     * superseded attempt is a no-op instead of overwriting or closing the
     * *new* attempt (old-success, old-error, and second-confirm races).
     */
    const attemptIdRef = useRef(0);

    useEffect(() => {
        const dialog = dialogRef.current;
        if (!dialog) return;
        if (isOpen && !dialog.open) {
            // Retire any confirm attempt from a previous open — see
            // attemptIdRef's doc comment. Without this, a still-in-flight
            // onConfirm() from a force-closed dialog could settle after
            // reopen and stomp the new attempt's state or close the dialog
            // out from under it.
            attemptIdRef.current += 1;
            // A stale isPending from that prior attempt — e.g. a caller
            // that closes the dialog by some path other than
            // Cancel/Escape/a completed confirm, all three of which
            // already imply isPending is false — could otherwise persist
            // into this reopen and leave Cancel/Confirm incorrectly
            // disabled. Reset both per-attempt fields so every open starts
            // clean.
            setError(null);
            setIsPending(false);
            dialog.showModal();
        } else if (!isOpen && dialog.open) {
            dialog.close();
        }
    }, [isOpen]);

    const handleCancelClick = () => {
        dialogRef.current?.close();
    };

    const handleConfirmClick = async () => {
        const attemptId = ++attemptIdRef.current;
        setError(null);
        setIsPending(true);
        try {
            const result = await onConfirm();
            if (attemptIdRef.current !== attemptId) {
                // Superseded by a reopen (or a newer confirm click) while
                // this attempt was in flight. Its result no longer belongs
                // to the dialog the user is looking at — never close on
                // its behalf or otherwise touch state.
                return;
            }
            if (result && "error" in result && result.error) {
                setError(result.error);
                return;
            }
            dialogRef.current?.close();
        } catch {
            // `onConfirm` rejected instead of resolving `{ error }` — an
            // unexpected failure (network drop, unhandled exception in the
            // server action) rather than a domain-level rejection the
            // caller already mapped. Never surface the raw exception (it
            // could leak internal details); keep the dialog open with a
            // safe generic message so the user can retry or cancel instead
            // of the action silently vanishing.
            if (attemptIdRef.current !== attemptId) return;
            setError("Something went wrong. Please try again.");
        } finally {
            if (attemptIdRef.current === attemptId) {
                setIsPending(false);
            }
        }
    };

    return (
        <dialog
            ref={dialogRef}
            onClose={onClose}
            onCancel={(e) => {
                // Escape fires "cancel" then "close". Block it mid-request so a
                // completing mutation can't land after the dialog (and its
                // error slot) have already been dismissed.
                if (isPending) {
                    e.preventDefault();
                }
            }}
            aria-labelledby={titleId}
            aria-describedby={description ? descriptionId : undefined}
            className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 rounded-lg p-0 backdrop:bg-black/50 max-w-md w-full m-0 bg-surface border border-border"
        >
            <div className="p-6 flex flex-col gap-4 min-w-0">
                <h2 id={titleId} className="text-lg font-semibold text-text-primary break-words">
                    {title}
                </h2>
                {description && (
                    <div id={descriptionId} className="min-w-0 break-words">
                        {description}
                    </div>
                )}
                {error && (
                    <div
                        role="alert"
                        className="p-3 bg-danger/10 border border-danger/30 rounded-md text-sm text-danger-light"
                    >
                        {error}
                    </div>
                )}
                <div className="flex gap-2 justify-end mt-2">
                    <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={handleCancelClick}
                        disabled={isPending}
                    >
                        {cancelLabel}
                    </Button>
                    <Button
                        type="button"
                        variant={confirmVariant}
                        size="sm"
                        onClick={handleConfirmClick}
                        disabled={isPending || confirmDisabled}
                        loading={isPending}
                    >
                        {isPending ? pendingLabel : confirmLabel}
                    </Button>
                </div>
            </div>
        </dialog>
    );
}
