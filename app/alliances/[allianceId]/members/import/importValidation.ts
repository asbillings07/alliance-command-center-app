import { MAX_PHYSICAL_ROWS_PER_SHEET } from "@/app/src/lib/workbookParser";
import { parseStrictInteger } from "@/app/src/lib/numberParser";

/**
 * Shared *structural* validation for both roster-import server actions
 * (current-roster `importMembers()` and historical-roster
 * `importHistoricalRoster()`): provenance metadata, the abuse-protection row
 * ceiling, source-row identity, and empty-name filtering. Deliberately does
 * NOT include THP/role validation — #282's field policy means historical
 * mode ignores file THP/role entirely for any row that matches an existing
 * member (restore preserves current values; already-matches/conflict rows
 * are never mutated at all), so validating them here would incorrectly
 * block a row over a value that will never actually be applied. Each action
 * validates THP/role itself, scoped to only the rows whose classification
 * says the file's value will be used — see historicalAction.ts's
 * "applied-field validation" step for that half.
 */

// Provenance metadata about the uploaded file. Client-supplied display
// metadata, not authenticated proof — validated here before it's trusted
// for history.
export type ImportProvenance = {
    fileName: string;
    sourceSheetName: string;
};

const MAX_NAME_METADATA_LENGTH = 255;
const MAX_ENTRIES = 2000;

export type ProvenanceValidationResult =
    | { success: true; fileName: string; sourceSheetName: string }
    | { success: false; error: string };

/**
 * Validates the client-supplied provenance object. Must run before touching
 * any property or calling `.trim()`: a caller that bypasses the
 * `ImportProvenance` TypeScript type (e.g. calling a server action directly)
 * could send an entirely missing/null/non-object argument.
 */
export function validateImportProvenance(provenance: unknown): ProvenanceValidationResult {
    if (provenance === null || typeof provenance !== "object") {
        return { success: false, error: "Missing or invalid file name" };
    }
    const candidate = provenance as Partial<ImportProvenance>;
    if (typeof candidate.fileName !== "string") {
        return { success: false, error: "Missing or invalid file name" };
    }
    if (typeof candidate.sourceSheetName !== "string") {
        return { success: false, error: "Missing or invalid worksheet name" };
    }

    const fileName = candidate.fileName.trim();
    const sourceSheetName = candidate.sourceSheetName.trim();
    if (fileName.length === 0 || fileName.length > MAX_NAME_METADATA_LENGTH) {
        return { success: false, error: "Missing or invalid file name" };
    }
    if (sourceSheetName.length === 0 || sourceSheetName.length > MAX_NAME_METADATA_LENGTH) {
        return { success: false, error: "Missing or invalid worksheet name" };
    }

    return { success: true, fileName, sourceSheetName };
}

export type StructuralEntry = {
    playerName: string;
    sourceRow: number;
};

export type StructuralValidationSuccess<T> = {
    success: true;
    validatedEntries: T[];
    skippedEmptyNames: number;
};

export type StructuralValidationFailure = {
    success: false;
    errors: string[];
    skippedEmptyNames: number;
};

export type StructuralValidationResult<T> = StructuralValidationSuccess<T> | StructuralValidationFailure;

/**
 * Validates row count, source-row identity, and player names for any roster
 * entry shape — generic over `T` so each action's own richer entry type
 * (e.g. `RosterEntry` with `thp`/`role`/`restore`, or historical import's
 * entry with `finalStatus`) passes through with `playerName` trimmed and
 * every other field untouched.
 */
export function validateStructuralEntries<T extends StructuralEntry>(
    entries: T[]
): StructuralValidationResult<T> {
    if (entries.length === 0) {
        return { success: false, errors: ["No entries to import"], skippedEmptyNames: 0 };
    }

    // Abuse protection ceiling for row count (separate from the 100-active-member domain capacity).
    if (entries.length > MAX_ENTRIES) {
        return {
            success: false,
            errors: [`File exceeds maximum technical ceiling of ${MAX_ENTRIES.toLocaleString("en-US")} entries`],
            skippedEmptyNames: 0,
        };
    }

    // sourceRow must be a positive, safe integer within the parser's physical
    // row ceiling, and a source row cannot produce multiple affected changes
    // — enforced here by requiring every submitted sourceRow to be unique,
    // and backed at the DB by MemberImportChange's
    // @@unique([memberImportId, sourceRow]).
    const seenSourceRows = new Set<number>();
    for (const entry of entries) {
        if (
            !Number.isSafeInteger(entry.sourceRow) ||
            entry.sourceRow <= 0 ||
            entry.sourceRow > MAX_PHYSICAL_ROWS_PER_SHEET
        ) {
            return {
                success: false,
                errors: [`Invalid source row for player "${entry.playerName}"`],
                skippedEmptyNames: 0,
            };
        }
        if (seenSourceRows.has(entry.sourceRow)) {
            return {
                success: false,
                errors: [`Duplicate source row ${entry.sourceRow} in submitted entries`],
                skippedEmptyNames: 0,
            };
        }
        seenSourceRows.add(entry.sourceRow);
    }

    // Validate player names - filter out empty/whitespace-only entries.
    let skippedEmptyNames = 0;
    const validatedEntries: T[] = [];
    for (const entry of entries) {
        const trimmedName = entry.playerName.trim();
        if (!trimmedName) {
            skippedEmptyNames++;
        } else {
            validatedEntries.push({ ...entry, playerName: trimmedName });
        }
    }

    if (validatedEntries.length === 0) {
        return {
            success: false,
            errors:
                skippedEmptyNames > 0 ? ["All entries have empty player names"] : ["No valid entries to import"],
            skippedEmptyNames,
        };
    }

    return { success: true, validatedEntries, skippedEmptyNames };
}

export type ThpValidationResult =
    | { success: true; parsedThp: number | undefined }
    | { success: false; error: string };

/**
 * Validates a raw THP cell value against the same domain rule everywhere
 * THP is ever accepted from a file: must be a raw string, must parse with
 * `parseStrictInteger`, and must not be negative. Shared by both roster
 * import actions so a value is never accepted in one flow and rejected in
 * the other. `undefined`/`null`/empty-after-trim all mean "no THP
 * provided" and are not errors — the field is optional.
 *
 * Historical import (#282) calls this only for rows whose classification
 * says the file's THP will actually be applied (new members) — never for a
 * row that matches an existing member, whose current THP is preserved
 * rather than overwritten.
 */
export function validateThpValue(thp: string | undefined, playerName: string): ThpValidationResult {
    if (thp === undefined || thp === null) {
        return { success: true, parsedThp: undefined };
    }
    if (typeof thp !== "string") {
        return {
            success: false,
            error: `Invalid THP value for player "${playerName}": THP must be provided as a raw string`,
        };
    }
    const rawThpStr = thp.trim();
    if (rawThpStr === "") {
        return { success: true, parsedThp: undefined };
    }
    const parsed = parseStrictInteger(rawThpStr);
    if (!parsed.success) {
        return {
            success: false,
            error: `Invalid THP value "${rawThpStr}" for player "${playerName}": ${parsed.error}`,
        };
    }
    if (parsed.value < 0) {
        return {
            success: false,
            error: `Total Hero Power cannot be negative for player "${playerName}" (${parsed.value})`,
        };
    }
    return { success: true, parsedThp: parsed.value };
}
