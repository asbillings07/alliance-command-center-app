import { describe, it, expect } from "vitest";
import {
  classifyInvitationConflict,
  describeInvitationConflict,
  toInvitationConflictType,
  BetaInvitationConflictError,
  type InvitationConflictFacts,
  type InvitationConflictResolution,
} from "./invitationConflict";
import { InvitationConflictType } from "@/app/generated/prisma/enums";

function baseFacts(overrides: Partial<InvitationConflictFacts> = {}): InvitationConflictFacts {
  return {
    pendingInvitation: null,
    existingUser: null,
    memberships: [],
    resolvedParticipantIdentityAmbiguous: false,
    participantCandidates: { fromEmailHistory: null, fromUser: null },
    latestInvitationForParticipant: null,
    ...overrides,
  };
}

describe("classifyInvitationConflict", () => {
  it("returns NONE when there is no conflicting evidence at all", () => {
    const result = classifyInvitationConflict(baseFacts());
    expect(result).toEqual({ primary: { type: "NONE" }, all: [] });
  });

  it("classifies an active pending invitation", () => {
    const result = classifyInvitationConflict(
      baseFacts({ pendingInvitation: { id: "inv-pending" } }),
    );
    expect(result.primary).toEqual({
      type: "ACTIVE_PENDING_INVITATION",
      invitationId: "inv-pending",
    });
  });

  it("classifies existing alliance access, using the earliest membership and total count", () => {
    const result = classifyInvitationConflict(
      baseFacts({
        existingUser: { id: "user-1", email: "a@example.com", displayName: "Alice" },
        memberships: [
          { allianceId: "alliance-1", allianceName: "First Alliance" },
          { allianceId: "alliance-2", allianceName: "Second Alliance" },
        ],
      }),
    );
    expect(result.primary).toEqual({
      type: "EXISTING_ALLIANCE_ACCESS",
      userId: "user-1",
      userEmail: "a@example.com",
      userDisplayName: "Alice",
      allianceId: "alliance-1",
      allianceName: "First Alliance",
      membershipCount: 2,
    });
  });

  it("classifies identity ambiguity when email-history and user candidates disagree", () => {
    const result = classifyInvitationConflict(
      baseFacts({
        resolvedParticipantIdentityAmbiguous: true,
        participantCandidates: {
          fromEmailHistory: { id: "participant-a", identityAmbiguous: false },
          fromUser: { id: "participant-b", identityAmbiguous: false },
        },
      }),
    );
    expect(result.primary.type).toBe("IDENTITY_AMBIGUOUS");
    expect(result.primary).toMatchObject({
      type: "IDENTITY_AMBIGUOUS",
      participantIds: expect.arrayContaining(["participant-a", "participant-b"]),
    });
  });

  it("classifies identity ambiguity when a prior merge already flagged the participant, even with only one candidate", () => {
    const result = classifyInvitationConflict(
      baseFacts({
        resolvedParticipantIdentityAmbiguous: true,
        participantCandidates: {
          fromEmailHistory: { id: "participant-a", identityAmbiguous: true },
          fromUser: null,
        },
      }),
    );
    expect(result.primary).toEqual({
      type: "IDENTITY_AMBIGUOUS",
      participantIds: ["participant-a"],
    });
  });

  it("classifies an already-accepted latest attempt distinctly from a reissue-eligible one", () => {
    const result = classifyInvitationConflict(
      baseFacts({
        participantCandidates: { fromEmailHistory: { id: "participant-1", identityAmbiguous: false }, fromUser: null },
        latestInvitationForParticipant: { id: "inv-1", acceptedAt: new Date() },
      }),
    );
    expect(result.primary).toEqual({
      type: "ALREADY_ACCEPTED",
      invitationId: "inv-1",
      participantId: "participant-1",
    });
  });

  it("classifies a terminal (expired/revoked) latest attempt as reissue-eligible", () => {
    const result = classifyInvitationConflict(
      baseFacts({
        participantCandidates: { fromEmailHistory: { id: "participant-1", identityAmbiguous: false }, fromUser: null },
        latestInvitationForParticipant: { id: "inv-1", acceptedAt: null },
      }),
    );
    expect(result.primary).toEqual({
      type: "EXISTING_PARTICIPANT_REISSUE",
      participantId: "participant-1",
    });
  });

  describe("precedence", () => {
    // Approved order (highest first): EXISTING_ALLIANCE_ACCESS ->
    // IDENTITY_AMBIGUOUS -> ACTIVE_PENDING_INVITATION -> ALREADY_ACCEPTED ->
    // EXISTING_PARTICIPANT_REISSUE. `all` is returned sorted in this same
    // order, so `primary === all[0]` always holds — verified below rather
    // than only documented, so a future reordering bug fails a test instead
    // of only a code review.

    it("prefers EXISTING_ALLIANCE_ACCESS over every other conflict, and returns `all` sorted so primary === all[0]", () => {
      const result = classifyInvitationConflict(
        baseFacts({
          pendingInvitation: { id: "inv-pending" },
          existingUser: { id: "user-1", email: "a@example.com", displayName: "Alice" },
          memberships: [{ allianceId: "alliance-1", allianceName: "Alliance" }],
          resolvedParticipantIdentityAmbiguous: true,
          participantCandidates: {
            fromEmailHistory: { id: "p-a", identityAmbiguous: false },
            fromUser: { id: "p-b", identityAmbiguous: false },
          },
        }),
      );
      expect(result.primary.type).toBe("EXISTING_ALLIANCE_ACCESS");
      expect(result.all).toHaveLength(3);
      expect(result.all[0]).toBe(result.primary);
      expect(result.all.map((d) => d.type)).toEqual([
        "EXISTING_ALLIANCE_ACCESS",
        "IDENTITY_AMBIGUOUS",
        "ACTIVE_PENDING_INVITATION",
      ]);
    });

    it("prefers EXISTING_ALLIANCE_ACCESS over a stale ACTIVE_PENDING_INVITATION alone — no invitation/email is needed once access already exists, so telling the operator to resend would be wrong guidance", () => {
      const result = classifyInvitationConflict(
        baseFacts({
          pendingInvitation: { id: "inv-pending" },
          existingUser: { id: "user-1", email: "a@example.com", displayName: "Alice" },
          memberships: [{ allianceId: "alliance-1", allianceName: "Alliance" }],
        }),
      );
      expect(result.primary.type).toBe("EXISTING_ALLIANCE_ACCESS");
      expect(result.all[0]).toBe(result.primary);
      expect(result.all.map((d) => d.type)).toEqual(["EXISTING_ALLIANCE_ACCESS", "ACTIVE_PENDING_INVITATION"]);
    });

    it("prefers IDENTITY_AMBIGUOUS over a stale ACTIVE_PENDING_INVITATION alone — resend would claim through a participant the accept path itself rejects as ambiguous", () => {
      const result = classifyInvitationConflict(
        baseFacts({
          pendingInvitation: { id: "inv-pending" },
          resolvedParticipantIdentityAmbiguous: true,
          participantCandidates: {
            fromEmailHistory: { id: "p-a", identityAmbiguous: false },
            fromUser: { id: "p-b", identityAmbiguous: false },
          },
        }),
      );
      expect(result.primary.type).toBe("IDENTITY_AMBIGUOUS");
      expect(result.all[0]).toBe(result.primary);
      expect(result.all.map((d) => d.type)).toEqual(["IDENTITY_AMBIGUOUS", "ACTIVE_PENDING_INVITATION"]);
    });

    it("prefers EXISTING_ALLIANCE_ACCESS over identity ambiguity and participant history", () => {
      const result = classifyInvitationConflict(
        baseFacts({
          existingUser: { id: "user-1", email: "a@example.com", displayName: "Alice" },
          memberships: [{ allianceId: "alliance-1", allianceName: "Alliance" }],
          resolvedParticipantIdentityAmbiguous: true,
          participantCandidates: {
            fromEmailHistory: { id: "p-a", identityAmbiguous: false },
            fromUser: { id: "p-b", identityAmbiguous: false },
          },
        }),
      );
      expect(result.primary.type).toBe("EXISTING_ALLIANCE_ACCESS");
    });

    it("prefers IDENTITY_AMBIGUOUS over an already-resolved participant history reading", () => {
      // Constructed defensively: latestInvitationForParticipant should never
      // be populated alongside ambiguity in real gathered facts (the gatherer
      // only looks it up when the candidates agree), but the classifier must
      // still refuse to trust participant-history facts once ambiguity is
      // flagged, in case that invariant is ever violated upstream.
      const result = classifyInvitationConflict(
        baseFacts({
          resolvedParticipantIdentityAmbiguous: true,
          participantCandidates: {
            fromEmailHistory: { id: "p-a", identityAmbiguous: false },
            fromUser: { id: "p-b", identityAmbiguous: false },
          },
          latestInvitationForParticipant: { id: "inv-1", acceptedAt: null },
        }),
      );
      expect(result.primary.type).toBe("IDENTITY_AMBIGUOUS");
    });
  });
});

describe("describeInvitationConflict / BetaInvitationConflictError", () => {
  it("produces the canonical message for each conflict type", () => {
    expect(describeInvitationConflict({ type: "ACTIVE_PENDING_INVITATION", invitationId: "i" })).toContain(
      "resend it instead",
    );
    expect(
      describeInvitationConflict({
        type: "EXISTING_ALLIANCE_ACCESS",
        userId: "u",
        userEmail: "e",
        userDisplayName: "d",
        allianceId: "a",
        allianceName: "n",
        membershipCount: 1,
      }),
    ).toBe("This user already has access to an alliance");
    expect(describeInvitationConflict({ type: "IDENTITY_AMBIGUOUS", participantIds: ["p"] })).toContain(
      "ambiguous",
    );
    expect(
      describeInvitationConflict({ type: "ALREADY_ACCEPTED", invitationId: "i", participantId: "p" }),
    ).toContain("already accepted");
    expect(describeInvitationConflict({ type: "EXISTING_PARTICIPANT_REISSUE", participantId: "p" })).toContain(
      "use Reissue",
    );
  });

  it("BetaInvitationConflictError carries the resolution and uses the primary's message", () => {
    const resolution = classifyInvitationConflict(
      baseFacts({ pendingInvitation: { id: "inv-1" } }),
    );
    expect(resolution.primary.type).not.toBe("NONE");
    const error = new BetaInvitationConflictError(
      resolution as Exclude<InvitationConflictResolution, { primary: { type: "NONE" } }>,
    );
    expect(error.name).toBe("BetaInvitationConflictError");
    expect(error.resolution.primary).toEqual(resolution.primary);
    expect(error.message).toContain("resend it instead");
  });
});

describe("toInvitationConflictType", () => {
  it("maps every conflict detail type onto the persisted enum", () => {
    expect(toInvitationConflictType({ type: "NONE" })).toBe(InvitationConflictType.NONE);
    expect(
      toInvitationConflictType({ type: "ACTIVE_PENDING_INVITATION", invitationId: "i" }),
    ).toBe(InvitationConflictType.ACTIVE_PENDING_INVITATION);
    expect(
      toInvitationConflictType({
        type: "EXISTING_ALLIANCE_ACCESS",
        userId: "u",
        userEmail: "e",
        userDisplayName: "d",
        allianceId: "a",
        allianceName: "n",
        membershipCount: 1,
      }),
    ).toBe(InvitationConflictType.EXISTING_ALLIANCE_ACCESS);
    expect(toInvitationConflictType({ type: "IDENTITY_AMBIGUOUS", participantIds: ["p"] })).toBe(
      InvitationConflictType.IDENTITY_AMBIGUOUS,
    );
    expect(
      toInvitationConflictType({ type: "ALREADY_ACCEPTED", invitationId: "i", participantId: "p" }),
    ).toBe(InvitationConflictType.ALREADY_ACCEPTED);
    expect(
      toInvitationConflictType({ type: "EXISTING_PARTICIPANT_REISSUE", participantId: "p" }),
    ).toBe(InvitationConflictType.EXISTING_PARTICIPANT_REISSUE);
  });
});
