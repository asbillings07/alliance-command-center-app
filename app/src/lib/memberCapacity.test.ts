import { describe, it, expect } from "vitest";
import {
    MAX_ACTIVE_ALLIANCE_MEMBERS,
    getAvailableMemberCapacity,
    getBulkMemberCapacityError,
    getSingleMemberCapacityError,
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

describe("getBulkMemberCapacityError", () => {
    it("returns null when the requested count fits within available capacity", () => {
        expect(getBulkMemberCapacityError(82, 18, "add")).toBeNull();
    });

    it("returns null when requesting exactly the remaining headroom", () => {
        expect(getBulkMemberCapacityError(90, 10, "restore")).toBeNull();
    });

    it("returns an actionable error when the request exceeds available capacity", () => {
        const error = getBulkMemberCapacityError(82, 24, "add");

        expect(error).toBe(
            "Your alliance has 82 active members, so you can add 18 more. " +
                "You currently have 24 members selected. " +
                "Deselect 6 members to continue."
        );
    });

    it("uses the 'restore' verb and singular phrasing for a single-member restore over capacity", () => {
        const error = getBulkMemberCapacityError(100, 1, "restore");

        expect(error).toBe(
            "Your alliance has 100 active members, so you can restore 0 more. " +
                "You currently have 1 member selected. " +
                "Deselect 1 member to continue."
        );
    });

    it("matches the exact scenario from the PR 2 contract: 5 selected, only 3 spaces remain", () => {
        const error = getBulkMemberCapacityError(97, 5, "restore");

        expect(error).toBe(
            "Your alliance has 97 active members, so you can restore 3 more. " +
                "You currently have 5 members selected. " +
                "Deselect 2 members to continue."
        );
    });
});

describe("getSingleMemberCapacityError", () => {
    it("returns null when there is room for one more member", () => {
        expect(getSingleMemberCapacityError(99, "add")).toBeNull();
    });

    it("returns null when exactly at the last available slot", () => {
        expect(getSingleMemberCapacityError(MAX_ACTIVE_ALLIANCE_MEMBERS - 1, "restore")).toBeNull();
    });

    it("returns a plain, actionable error at the cap for 'add' — no selection/deselect language", () => {
        const error = getSingleMemberCapacityError(MAX_ACTIVE_ALLIANCE_MEMBERS, "add");

        expect(error).toBe(
            `Your alliance has ${MAX_ACTIVE_ALLIANCE_MEMBERS} active members, so you can add 0 more.`
        );
        expect(error).not.toMatch(/selected|deselect/i);
    });

    it("returns a plain, actionable error at the cap for 'restore' — no selection/deselect language", () => {
        const error = getSingleMemberCapacityError(MAX_ACTIVE_ALLIANCE_MEMBERS, "restore");

        expect(error).toBe(
            `Your alliance has ${MAX_ACTIVE_ALLIANCE_MEMBERS} active members, so you can restore 0 more.`
        );
        expect(error).not.toMatch(/selected|deselect/i);
    });
});
