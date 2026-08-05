import { describe, it, expect } from "vitest";
import { describeRollbackEvidence, pluralize, type RollbackEvidence } from "./describeRollbackEvidence";

function buildEvidence(overrides: Partial<RollbackEvidence> = {}): RollbackEvidence {
    return {
        memberMissing: false,
        driftedFields: [],
        hadLaterImportInvolvement: false,
        hadLinkedUser: false,
        metricEntryCount: 0,
        leadershipNoteCount: 0,
        invitationCount: 0,
        ...overrides,
    };
}

describe("pluralize", () => {
    it("uses the bare noun for a count of 1", () => {
        expect(pluralize(1, "member")).toBe("1 member");
        expect(pluralize(1, "entry")).toBe("1 entry");
    });

    it("appends 's' for a regular noun", () => {
        expect(pluralize(2, "member")).toBe("2 members");
        expect(pluralize(0, "invitation")).toBe("0 invitations");
    });

    it("uses '-ies' for a consonant-plus-y noun instead of blindly appending 's'", () => {
        expect(pluralize(2, "entry")).toBe("2 entries");
        expect(pluralize(2, "metric entry")).toBe("2 metric entries");
    });

    it("still appends 's' for a vowel-plus-y noun", () => {
        expect(pluralize(2, "day")).toBe("2 days");
    });
});

describe("describeRollbackEvidence", () => {
    it("returns no reasons for evidence with nothing set — a clean row has nothing to explain", () => {
        expect(describeRollbackEvidence(buildEvidence())).toEqual([]);
    });

    it("short-circuits to a single, specific reason when the member is missing — never all-empty and unexplained", () => {
        const reasons = describeRollbackEvidence(
            buildEvidence({
                memberMissing: true,
                // Even if some other field happened to be set, missing-member
                // is definitionally exclusive — there's no live row left to
                // have drifted, gained a user, or gained dependencies.
                driftedFields: ["thp"],
            })
        );
        expect(reasons).toEqual(["This member no longer exists."]);
    });

    it("lists drifted fields verbatim, joined by comma", () => {
        expect(describeRollbackEvidence(buildEvidence({ driftedFields: ["thp", "role"] }))).toEqual([
            "Changed since import: thp, role",
        ]);
    });

    it("reports later-import involvement as its own reason", () => {
        expect(describeRollbackEvidence(buildEvidence({ hadLaterImportInvolvement: true }))).toEqual([
            "Touched by a later import",
        ]);
    });

    it("reports a linked user as its own reason", () => {
        expect(describeRollbackEvidence(buildEvidence({ hadLinkedUser: true }))).toEqual([
            "Now linked to a user account",
        ]);
    });

    it("pluralizes each dependency count correctly, including the irregular 'entries'", () => {
        expect(
            describeRollbackEvidence(
                buildEvidence({ metricEntryCount: 2, leadershipNoteCount: 1, invitationCount: 3 })
            )
        ).toEqual([
            "2 metric entries recorded since",
            "1 leadership note recorded since",
            "3 invitations issued since",
        ]);
    });

    it("combines every applicable reason for a multi-cause conflict, in a stable order", () => {
        const reasons = describeRollbackEvidence(
            buildEvidence({
                driftedFields: ["thp"],
                hadLaterImportInvolvement: true,
                hadLinkedUser: true,
                metricEntryCount: 1,
            })
        );
        expect(reasons).toEqual([
            "Changed since import: thp",
            "Touched by a later import",
            "Now linked to a user account",
            "1 metric entry recorded since",
        ]);
    });
});
