import { describe, it, expect } from "vitest";
import {
    MAX_ACTIVE_ALLIANCE_MEMBERS,
    getAvailableMemberCapacity,
    getMemberCapacityError,
} from "./memberCapacity";

describe("getAvailableMemberCapacity", () => {
    it("returns the remaining headroom under the cap", () => {
        expect(getAvailableMemberCapacity(82)).toBe(18);
    });

    it("returns 0 when exactly at the cap", () => {
        expect(getAvailableMemberCapacity(MAX_ACTIVE_ALLIANCE_MEMBERS)).toBe(0);
    });

    it("never returns a negative number when somehow over the cap", () => {
        expect(getAvailableMemberCapacity(150)).toBe(0);
    });
});

describe("getMemberCapacityError", () => {
    it("returns null when the requested count fits within available capacity", () => {
        expect(getMemberCapacityError(82, 18, "add")).toBeNull();
    });

    it("returns null when requesting exactly the remaining headroom", () => {
        expect(getMemberCapacityError(90, 10, "restore")).toBeNull();
    });

    it("returns an actionable error when the request exceeds available capacity", () => {
        const error = getMemberCapacityError(82, 24, "add");

        expect(error).toBe(
            "Your alliance has 82 active members, so you can add 18 more. " +
                "You currently have 24 members selected. " +
                "Deselect 6 members to continue."
        );
    });

    it("uses the 'restore' verb and singular phrasing for a single-member restore over capacity", () => {
        const error = getMemberCapacityError(100, 1, "restore");

        expect(error).toBe(
            "Your alliance has 100 active members, so you can restore 0 more. " +
                "You currently have 1 member selected. " +
                "Deselect 1 member to continue."
        );
    });

    it("matches the exact scenario from the PR 2 contract: 5 selected, only 3 spaces remain", () => {
        const error = getMemberCapacityError(97, 5, "restore");

        expect(error).toBe(
            "Your alliance has 97 active members, so you can restore 3 more. " +
                "You currently have 5 members selected. " +
                "Deselect 2 members to continue."
        );
    });
});
