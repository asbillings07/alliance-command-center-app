import { describe, it, expect } from "vitest";
import { validateImportProvenance, validateStructuralEntries, validateThpValue } from "./importValidation";

describe("validateImportProvenance", () => {
    it("accepts a valid provenance object and trims values", () => {
        const result = validateImportProvenance({ fileName: "  roster.xlsx  ", sourceSheetName: " Sheet1 " });
        expect(result).toEqual({ success: true, fileName: "roster.xlsx", sourceSheetName: "Sheet1" });
    });

    it("rejects null", () => {
        expect(validateImportProvenance(null)).toEqual({
            success: false,
            error: "Missing or invalid file name",
        });
    });

    it("rejects a non-object", () => {
        expect(validateImportProvenance("nope")).toEqual({
            success: false,
            error: "Missing or invalid file name",
        });
    });

    it("rejects a missing fileName", () => {
        expect(validateImportProvenance({ sourceSheetName: "Sheet1" })).toEqual({
            success: false,
            error: "Missing or invalid file name",
        });
    });

    it("rejects a missing sourceSheetName", () => {
        expect(validateImportProvenance({ fileName: "roster.xlsx" })).toEqual({
            success: false,
            error: "Missing or invalid worksheet name",
        });
    });

    it("rejects an empty (whitespace-only) fileName", () => {
        expect(validateImportProvenance({ fileName: "   ", sourceSheetName: "Sheet1" })).toEqual({
            success: false,
            error: "Missing or invalid file name",
        });
    });

    it("rejects a fileName over the 255-char metadata limit", () => {
        const longName = "a".repeat(256);
        expect(validateImportProvenance({ fileName: longName, sourceSheetName: "Sheet1" })).toEqual({
            success: false,
            error: "Missing or invalid file name",
        });
    });
});

type TestEntry = { playerName: string; sourceRow: number; extra?: string };

describe("validateStructuralEntries", () => {
    it("passes through valid entries with trimmed names, preserving extra fields", () => {
        const result = validateStructuralEntries<TestEntry>([
            { playerName: "  Alice  ", sourceRow: 1, extra: "keep-me" },
        ]);
        expect(result).toEqual({
            success: true,
            validatedEntries: [{ playerName: "Alice", sourceRow: 1, extra: "keep-me" }],
            skippedEmptyNames: 0,
        });
    });

    it("rejects an empty entries array", () => {
        const result = validateStructuralEntries<TestEntry>([]);
        expect(result).toEqual({ success: false, errors: ["No entries to import"], skippedEmptyNames: 0 });
    });

    it("rejects more than 2000 entries", () => {
        const entries: TestEntry[] = Array.from({ length: 2001 }, (_, i) => ({
            playerName: `Player${i}`,
            sourceRow: i + 1,
        }));
        const result = validateStructuralEntries<TestEntry>(entries);
        expect(result).toEqual({
            success: false,
            errors: ["File exceeds maximum technical ceiling of 2,000 entries"],
            skippedEmptyNames: 0,
        });
    });

    it("rejects a non-positive sourceRow", () => {
        const result = validateStructuralEntries<TestEntry>([{ playerName: "Alice", sourceRow: 0 }]);
        expect(result).toEqual({
            success: false,
            errors: [`Invalid source row for player "Alice"`],
            skippedEmptyNames: 0,
        });
    });

    it("rejects a non-integer sourceRow", () => {
        const result = validateStructuralEntries<TestEntry>([{ playerName: "Alice", sourceRow: 1.5 }]);
        expect(result.success).toBe(false);
    });

    it("rejects duplicate sourceRow values", () => {
        const result = validateStructuralEntries<TestEntry>([
            { playerName: "Alice", sourceRow: 1 },
            { playerName: "Bob", sourceRow: 1 },
        ]);
        expect(result).toEqual({
            success: false,
            errors: ["Duplicate source row 1 in submitted entries"],
            skippedEmptyNames: 0,
        });
    });

    it("filters empty/whitespace-only names and counts them", () => {
        const result = validateStructuralEntries<TestEntry>([
            { playerName: "Alice", sourceRow: 1 },
            { playerName: "   ", sourceRow: 2 },
        ]);
        expect(result).toEqual({
            success: true,
            validatedEntries: [{ playerName: "Alice", sourceRow: 1 }],
            skippedEmptyNames: 1,
        });
    });

    it("returns 'All entries have empty player names' when every entry is empty", () => {
        const result = validateStructuralEntries<TestEntry>([{ playerName: "   ", sourceRow: 1 }]);
        expect(result).toEqual({
            success: false,
            errors: ["All entries have empty player names"],
            skippedEmptyNames: 1,
        });
    });
});

describe("validateThpValue", () => {
    it("treats undefined as 'no THP provided' — not an error", () => {
        expect(validateThpValue(undefined, "Alice")).toEqual({ success: true, parsedThp: undefined });
    });

    it("treats an empty (whitespace-only) string as 'no THP provided'", () => {
        expect(validateThpValue("   ", "Alice")).toEqual({ success: true, parsedThp: undefined });
    });

    it("parses a valid raw THP string", () => {
        expect(validateThpValue("450000000", "Alice")).toEqual({ success: true, parsedThp: 450000000 });
    });

    it("parses a formatted THP string via parseStrictInteger", () => {
        expect(validateThpValue("450,000,000", "Alice")).toEqual({ success: true, parsedThp: 450000000 });
    });

    it("rejects an unparseable THP string", () => {
        const result = validateThpValue("not-a-number", "Alice");
        expect(result.success).toBe(false);
        expect(result).toMatchObject({ error: expect.stringContaining('Invalid THP value "not-a-number"') });
    });

    it("rejects a negative THP value", () => {
        const result = validateThpValue("-5", "Alice");
        expect(result).toEqual({
            success: false,
            error: `Total Hero Power cannot be negative for player "Alice" (-5)`,
        });
    });

    it("rejects a non-string THP value", () => {
        const result = validateThpValue(12345 as unknown as string, "Alice");
        expect(result).toEqual({
            success: false,
            error: `Invalid THP value for player "Alice": THP must be provided as a raw string`,
        });
    });
});
