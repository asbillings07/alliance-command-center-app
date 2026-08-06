/**
 * Pure, dependency-free classification for a single historical-roster import
 * row (#277 PR 4 / #282). Mirrors memberCapacity.ts's design: no Prisma
 * import, so the exact same function runs in the Client Component that
 * renders the live preview and in the server action that re-derives the
 * authoritative classification inside the transaction. Neither side ever
 * reimplements the decision table independently — see historicalAction.ts's
 * own doc comment on why that matters for the stale-preview fingerprint
 * check.
 *
 * `finalStatus` is the leader's explicit request for where this row should
 * end up. "unassigned" has exactly one meaning everywhere it appears: it
 * always blocks a selected row, whether or not that row matched an existing
 * member. A matched row is never silently treated as "leave alone" merely
 * because it's unassigned — the client is responsible for initializing a
 * matched row's `finalStatus` to its current lifecycle state ("Preserve
 * Active"/"Preserve Archived") so it's a concrete, resolved value by
 * construction, not a state this function has to special-case.
 */
export type HistoricalFinalStatus = "active" | "archived" | "unassigned";

export type HistoricalRowOutcome =
    | "CREATE_ACTIVE"
    | "CREATE_ARCHIVED"
    | "RESTORE"
    | "ALREADY_MATCHES"
    | "LIFECYCLE_CONFLICT"
    | "UNASSIGNED_BLOCKED";

/**
 * What this row's outcome does with the file's mapped THP/role values.
 * Drives both which rows need THP/role validated (see #282's "validate only
 * applied fields" decision — action.ts's shared structural validation never
 * touches THP/role at all) and the stale-preview fingerprint, which must
 * treat a row whose applied-field policy changed between preview and commit
 * as stale even if its `finalStatus` request didn't change.
 */
export type AppliedFieldPolicy =
    | "APPLY_FILE_FIELDS"
    | "PRESERVE_CURRENT_FIELDS"
    | "NONE";

export type HistoricalRowClassification = {
    outcome: HistoricalRowOutcome;
    appliedFieldPolicy: AppliedFieldPolicy;
};

export type HistoricalMatchState = {
    /** False for a row with no existing AllianceMember match at all. */
    matched: boolean;
    /**
     * Only meaningful when `matched` is true. Whether the matched member is
     * currently archived.
     */
    currentlyArchived: boolean;
};

/**
 * Classifies one row per the #282 decision table:
 *
 * | Existing state    | finalStatus | Outcome              |
 * |-------------------|-------------|----------------------|
 * | No match          | active      | CREATE_ACTIVE        |
 * | No match          | archived    | CREATE_ARCHIVED       |
 * | Existing active   | active      | ALREADY_MATCHES        |
 * | Existing active   | archived    | LIFECYCLE_CONFLICT     |
 * | Existing archived | archived    | ALREADY_MATCHES        |
 * | Existing archived | active      | RESTORE                |
 * | (any)             | unassigned  | UNASSIGNED_BLOCKED     |
 *
 * `RESTORE` preserves the member's current thp/role rather than overwriting
 * them from the historical file (#282's field policy: historical
 * spreadsheets are snapshots, not authority for a present-day member's
 * profile) — a deliberate divergence from the current-roster restore path
 * in ../action.ts, which does overwrite thp/role from the file.
 */
export function classifyHistoricalRosterRow(
    match: HistoricalMatchState,
    finalStatus: HistoricalFinalStatus
): HistoricalRowClassification {
    if (finalStatus === "unassigned") {
        return { outcome: "UNASSIGNED_BLOCKED", appliedFieldPolicy: "NONE" };
    }

    if (!match.matched) {
        return finalStatus === "active"
            ? { outcome: "CREATE_ACTIVE", appliedFieldPolicy: "APPLY_FILE_FIELDS" }
            : { outcome: "CREATE_ARCHIVED", appliedFieldPolicy: "APPLY_FILE_FIELDS" };
    }

    if (match.currentlyArchived) {
        return finalStatus === "archived"
            ? { outcome: "ALREADY_MATCHES", appliedFieldPolicy: "NONE" }
            : { outcome: "RESTORE", appliedFieldPolicy: "PRESERVE_CURRENT_FIELDS" };
    }

    // Currently active.
    return finalStatus === "active"
        ? { outcome: "ALREADY_MATCHES", appliedFieldPolicy: "NONE" }
        : { outcome: "LIFECYCLE_CONFLICT", appliedFieldPolicy: "NONE" };
}

/**
 * Whether a row with this outcome consumes a slot in the 100-active-member
 * cap. Only a brand-new active creation or a restore-to-active ever does —
 * an archived-destined creation and every no-mutation outcome never do,
 * regardless of how many such rows are in the file (#282: "New
 * archived-destined rows and already-archived rows consume zero
 * active-roster capacity").
 */
export function outcomeConsumesActiveCapacity(outcome: HistoricalRowOutcome): boolean {
    return outcome === "CREATE_ACTIVE" || outcome === "RESTORE";
}
