import type { AppliedFieldPolicy, HistoricalFinalStatus } from "./historicalClassification";

/**
 * A canonical fingerprint of exactly the classification the *client*
 * reviewed for one selected row, computed from the same live member data
 * used to render the historical-import preview.
 *
 * Deliberately a plain, stably-ordered JSON string rather than a
 * cryptographic hash (contrast with rollbackPreview.ts's
 * `computePreviewFingerprint`, which uses SHA-256): this module runs in a
 * "use client" component as well as the server action, and Node's `crypto`
 * module isn't available in a browser bundle. There's also no security
 * requirement to hide or hash this — the server never trusts the client's
 * classification itself, only compares its own freshly-derived fingerprint
 * against what the client submitted, so a plain deterministic string is
 * exactly as safe as a hash for detecting drift.
 */
export type HistoricalFingerprintRow = {
    /** The file's own 1-based row identity — the authoritative anchor
     * (matches MemberImportChange's own `sourceRow`), since a normalized
     * name alone could theoretically repeat across source rows. */
    sourceRow: number;
    normalizedName: string;
    /** Null only when this row had no existing-member match. */
    matchedMemberId: string | null;
    /** Null only alongside `matchedMemberId: null`. */
    currentlyArchived: boolean | null;
    requestedStatus: HistoricalFinalStatus;
    appliedFieldPolicy: AppliedFieldPolicy;
};

/**
 * `importHistoricalRoster()` recomputes this fingerprint from a fresh
 * classification pass inside `withAllianceMemberLock` and rejects the whole
 * submission outright on any mismatch — never reconciling row-by-row. This
 * is what stops a lifecycle change that lands between preview and commit
 * (e.g. another leader archives a member the current leader reviewed as
 * "existing active, preserve active") from being silently reclassified and
 * acted on differently than what was actually reviewed — see historicalAction.ts's
 * own doc comment for the concrete scenario this prevents.
 *
 * Only rows the leader actually selected for submission belong here — a
 * row that's still "unassigned" blocks confirmation client-side and is
 * never included, so `requestedStatus` here is effectively always
 * `"active"` or `"archived"` in practice (the type still allows
 * `"unassigned"` so a caller can't silently coerce one away instead of
 * catching the bug).
 */
export function computeHistoricalImportFingerprint(rows: HistoricalFingerprintRow[]): string {
    const canonical = [...rows]
        .sort((a, b) => a.sourceRow - b.sourceRow)
        .map((row) => ({
            sourceRow: row.sourceRow,
            normalizedName: row.normalizedName,
            matchedMemberId: row.matchedMemberId,
            currentlyArchived: row.currentlyArchived,
            requestedStatus: row.requestedStatus,
            appliedFieldPolicy: row.appliedFieldPolicy,
        }));
    return JSON.stringify(canonical);
}
