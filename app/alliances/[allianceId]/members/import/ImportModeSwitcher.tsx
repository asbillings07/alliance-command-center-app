"use client";

import { useState } from "react";
import { RosterImportForm } from "./RosterImportForm";
import { HistoricalRosterImportForm } from "./HistoricalRosterImportForm";

type ExistingMember = {
    id: string;
    playerName: string;
    archivedAt: string | null;
};

type ImportMode = "current" | "historical";

type ImportModeSwitcherProps = {
    allianceId: string;
    existingMembers: ExistingMember[];
    returnTo?: string;
    /**
     * #282: historical mode requires both IMPORT_MEMBERS (already enforced
     * for the whole page) and MANAGE_MEMBERS — it can restore a member's
     * active lifecycle and directly create an already-archived member, both
     * more consequential than the current-roster import. Hide (not merely
     * disable) the tab for a caller who can't use it, mirroring how
     * destructive actions are hidden elsewhere in the app rather than shown
     * as an inert control — server-side authorization in
     * historicalAction.ts is the actual enforcement (ADR-006); this is only
     * about not advertising an action the user can't take.
     */
    canManageMembers: boolean;
};

export function ImportModeSwitcher({ allianceId, existingMembers, returnTo, canManageMembers }: ImportModeSwitcherProps) {
    const [mode, setMode] = useState<ImportMode>("current");

    return (
        <div className="flex flex-col gap-6">
            {/*
             * Deliberately plain toggle buttons, not an ARIA tablist. A real
             * tablist requires roving tabindex, arrow-key navigation, and an
             * associated tabpanel (WAI-ARIA APG) — implementing that for a
             * two-option mode switch is more machinery than this control's
             * actual complexity warrants. `aria-pressed` on an ordinary
             * `<button>` communicates the same "which mode is active" state
             * with coherent semantics, and needs no custom keyboard handling
             * at all: every browser already activates a focused `<button>`
             * on Enter/Space natively — see this file's own e2e keyboard
             * coverage for the real-browser proof.
             */}
            <div className="flex items-center gap-2 border-b border-border pb-3" role="group" aria-label="Import mode">
                <button
                    type="button"
                    aria-pressed={mode === "current"}
                    onClick={() => setMode("current")}
                    className={`px-4 py-2 rounded-md text-sm font-medium cursor-pointer ${
                        mode === "current"
                            ? "bg-primary text-white"
                            : "bg-surface-secondary text-text-secondary hover:bg-surface-secondary/70"
                    }`}
                >
                    Current Roster
                </button>
                {canManageMembers && (
                    <button
                        type="button"
                        aria-pressed={mode === "historical"}
                        onClick={() => setMode("historical")}
                        className={`px-4 py-2 rounded-md text-sm font-medium cursor-pointer ${
                            mode === "historical"
                                ? "bg-primary text-white"
                                : "bg-surface-secondary text-text-secondary hover:bg-surface-secondary/70"
                        }`}
                    >
                        Historical Roster
                    </button>
                )}
            </div>

            {mode === "current" ? (
                <RosterImportForm allianceId={allianceId} existingMembers={existingMembers} returnTo={returnTo} />
            ) : (
                <HistoricalRosterImportForm allianceId={allianceId} existingMembers={existingMembers} returnTo={returnTo} />
            )}
        </div>
    );
}
