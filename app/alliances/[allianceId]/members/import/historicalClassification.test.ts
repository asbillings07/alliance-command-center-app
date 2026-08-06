import { describe, it, expect } from "vitest";
import {
    classifyHistoricalRosterRow,
    outcomeConsumesActiveCapacity,
    type HistoricalMatchState,
} from "./historicalClassification";

const NO_MATCH: HistoricalMatchState = { matched: false, currentlyArchived: false };
const EXISTING_ACTIVE: HistoricalMatchState = { matched: true, currentlyArchived: false };
const EXISTING_ARCHIVED: HistoricalMatchState = { matched: true, currentlyArchived: true };

describe("classifyHistoricalRosterRow", () => {
    it("no match + active -> CREATE_ACTIVE, applies file fields", () => {
        expect(classifyHistoricalRosterRow(NO_MATCH, "active")).toEqual({
            outcome: "CREATE_ACTIVE",
            appliedFieldPolicy: "APPLY_FILE_FIELDS",
        });
    });

    it("no match + archived -> CREATE_ARCHIVED, applies file fields", () => {
        expect(classifyHistoricalRosterRow(NO_MATCH, "archived")).toEqual({
            outcome: "CREATE_ARCHIVED",
            appliedFieldPolicy: "APPLY_FILE_FIELDS",
        });
    });

    it("existing active + active (Preserve Active) -> ALREADY_MATCHES, no fields applied", () => {
        expect(classifyHistoricalRosterRow(EXISTING_ACTIVE, "active")).toEqual({
            outcome: "ALREADY_MATCHES",
            appliedFieldPolicy: "NONE",
        });
    });

    it("existing active + archived -> LIFECYCLE_CONFLICT, no fields applied (never auto-archived)", () => {
        expect(classifyHistoricalRosterRow(EXISTING_ACTIVE, "archived")).toEqual({
            outcome: "LIFECYCLE_CONFLICT",
            appliedFieldPolicy: "NONE",
        });
    });

    it("existing archived + archived (Preserve Archived) -> ALREADY_MATCHES, no fields applied", () => {
        expect(classifyHistoricalRosterRow(EXISTING_ARCHIVED, "archived")).toEqual({
            outcome: "ALREADY_MATCHES",
            appliedFieldPolicy: "NONE",
        });
    });

    it("existing archived + active -> RESTORE, preserves current fields (never overwrites from file)", () => {
        expect(classifyHistoricalRosterRow(EXISTING_ARCHIVED, "active")).toEqual({
            outcome: "RESTORE",
            appliedFieldPolicy: "PRESERVE_CURRENT_FIELDS",
        });
    });

    it("unassigned always blocks regardless of match state — no match", () => {
        expect(classifyHistoricalRosterRow(NO_MATCH, "unassigned")).toEqual({
            outcome: "UNASSIGNED_BLOCKED",
            appliedFieldPolicy: "NONE",
        });
    });

    it("unassigned always blocks regardless of match state — existing active", () => {
        expect(classifyHistoricalRosterRow(EXISTING_ACTIVE, "unassigned")).toEqual({
            outcome: "UNASSIGNED_BLOCKED",
            appliedFieldPolicy: "NONE",
        });
    });

    it("unassigned always blocks regardless of match state — existing archived", () => {
        expect(classifyHistoricalRosterRow(EXISTING_ARCHIVED, "unassigned")).toEqual({
            outcome: "UNASSIGNED_BLOCKED",
            appliedFieldPolicy: "NONE",
        });
    });
});

describe("outcomeConsumesActiveCapacity", () => {
    it("CREATE_ACTIVE consumes capacity", () => {
        expect(outcomeConsumesActiveCapacity("CREATE_ACTIVE")).toBe(true);
    });

    it("RESTORE consumes capacity", () => {
        expect(outcomeConsumesActiveCapacity("RESTORE")).toBe(true);
    });

    it("CREATE_ARCHIVED never consumes capacity", () => {
        expect(outcomeConsumesActiveCapacity("CREATE_ARCHIVED")).toBe(false);
    });

    it("ALREADY_MATCHES never consumes capacity", () => {
        expect(outcomeConsumesActiveCapacity("ALREADY_MATCHES")).toBe(false);
    });

    it("LIFECYCLE_CONFLICT never consumes capacity", () => {
        expect(outcomeConsumesActiveCapacity("LIFECYCLE_CONFLICT")).toBe(false);
    });

    it("UNASSIGNED_BLOCKED never consumes capacity", () => {
        expect(outcomeConsumesActiveCapacity("UNASSIGNED_BLOCKED")).toBe(false);
    });
});
