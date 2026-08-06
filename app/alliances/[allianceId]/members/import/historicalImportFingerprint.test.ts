import { describe, it, expect } from "vitest";
import {
    computeHistoricalImportFingerprint,
    type HistoricalFingerprintRow,
} from "./historicalImportFingerprint";

function buildRow(overrides: Partial<HistoricalFingerprintRow> = {}): HistoricalFingerprintRow {
    return {
        sourceRow: 1,
        normalizedName: "alice",
        matchedMemberId: null,
        currentlyArchived: null,
        requestedStatus: "active",
        appliedFieldPolicy: "APPLY_FILE_FIELDS",
        ...overrides,
    };
}

describe("computeHistoricalImportFingerprint", () => {
    it("is stable across repeated calls with identical input", () => {
        const rows = [buildRow()];
        expect(computeHistoricalImportFingerprint(rows)).toBe(computeHistoricalImportFingerprint(rows));
    });

    it("is independent of input array order (sorts by sourceRow)", () => {
        const rowA = buildRow({ sourceRow: 1, normalizedName: "alice" });
        const rowB = buildRow({ sourceRow: 2, normalizedName: "bob" });

        expect(computeHistoricalImportFingerprint([rowA, rowB])).toBe(
            computeHistoricalImportFingerprint([rowB, rowA])
        );
    });

    it("changes when matchedMemberId changes — a different member matched between preview and commit", () => {
        const before = computeHistoricalImportFingerprint([buildRow({ matchedMemberId: "member-1" })]);
        const after = computeHistoricalImportFingerprint([buildRow({ matchedMemberId: "member-2" })]);
        expect(before).not.toBe(after);
    });

    it("changes when currentlyArchived changes — a concurrent lifecycle change", () => {
        const before = computeHistoricalImportFingerprint([
            buildRow({ matchedMemberId: "member-1", currentlyArchived: false }),
        ]);
        const after = computeHistoricalImportFingerprint([
            buildRow({ matchedMemberId: "member-1", currentlyArchived: true }),
        ]);
        expect(before).not.toBe(after);
    });

    it("changes when requestedStatus changes", () => {
        const before = computeHistoricalImportFingerprint([buildRow({ requestedStatus: "active" })]);
        const after = computeHistoricalImportFingerprint([buildRow({ requestedStatus: "archived" })]);
        expect(before).not.toBe(after);
    });

    it("changes when appliedFieldPolicy changes even though requestedStatus/matchState didn't", () => {
        const before = computeHistoricalImportFingerprint([
            buildRow({ appliedFieldPolicy: "APPLY_FILE_FIELDS" }),
        ]);
        const after = computeHistoricalImportFingerprint([
            buildRow({ appliedFieldPolicy: "PRESERVE_CURRENT_FIELDS" }),
        ]);
        expect(before).not.toBe(after);
    });

    it("changes when a row is added or removed", () => {
        const one = computeHistoricalImportFingerprint([buildRow({ sourceRow: 1 })]);
        const two = computeHistoricalImportFingerprint([buildRow({ sourceRow: 1 }), buildRow({ sourceRow: 2 })]);
        expect(one).not.toBe(two);
    });

    it("is empty-array-safe", () => {
        expect(computeHistoricalImportFingerprint([])).toBe("[]");
    });
});
