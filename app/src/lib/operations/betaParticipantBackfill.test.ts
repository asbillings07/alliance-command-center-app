import { describe, it, expect } from "vitest";
import {
  planBackfillForEmailGroup,
  type BackfillInvitationSnapshot,
} from "./betaParticipantBackfill";

function row(
  id: string,
  overrides: Partial<BackfillInvitationSnapshot> = {},
): BackfillInvitationSnapshot {
  return {
    id,
    participantId: null,
    acceptedAt: null,
    acceptedByUserId: null,
    ...overrides,
  };
}

describe("planBackfillForEmailGroup", () => {
  it("returns null when every invitation already has participantId", () => {
    const plan = planBackfillForEmailGroup("shared@example.test", [
      row("inv-1", { participantId: "participant-1" }),
    ]);
    expect(plan).toBeNull();
  });

  it("assigns unaccepted history to a single new participant", () => {
    const plan = planBackfillForEmailGroup("solo@example.test", [
      row("inv-1"),
      row("inv-2"),
    ]);

    expect(plan).not.toBeNull();
    expect(plan!.assignments).toHaveLength(2);
    expect(plan!.assignments.every((a) => a.target.kind === "create")).toBe(
      true,
    );
    expect(
      plan!.assignments.every(
        (a) =>
          a.target.kind === "create" &&
          a.target.slotKey === "single" &&
          a.target.userId === null,
      ),
    ).toBe(true);
  });

  it("assigns accepted-only history to one participant with userId", () => {
    const plan = planBackfillForEmailGroup("accepted@example.test", [
      row("inv-1", {
        acceptedAt: new Date(),
        acceptedByUserId: "user-a",
      }),
    ]);

    expect(plan!.assignments).toHaveLength(1);
    expect(plan!.assignments[0].target).toMatchObject({
      kind: "create",
      slotKey: "single",
      userId: "user-a",
      identityAmbiguous: false,
    });
  });

  it("splits two distinct accepted users and flags ambiguous remainder", () => {
    const plan = planBackfillForEmailGroup("conflict@example.test", [
      row("inv-a", {
        acceptedAt: new Date(),
        acceptedByUserId: "user-a",
      }),
      row("inv-b", {
        acceptedAt: new Date(),
        acceptedByUserId: "user-b",
      }),
      row("inv-pending"),
      row("inv-expired"),
    ]);

    expect(plan!.assignments).toHaveLength(4);

    const byInvitation = Object.fromEntries(
      plan!.assignments.map((assignment) => [
        assignment.invitationId,
        assignment.target,
      ]),
    );

    expect(byInvitation["inv-a"]).toMatchObject({
      kind: "create",
      slotKey: "user:user-a",
      userId: "user-a",
      identityAmbiguous: false,
    });
    expect(byInvitation["inv-b"]).toMatchObject({
      kind: "create",
      slotKey: "user:user-b",
      userId: "user-b",
      identityAmbiguous: false,
    });
    expect(byInvitation["inv-pending"]).toMatchObject({
      kind: "create",
      slotKey: "__ambiguous__",
      userId: null,
      identityAmbiguous: true,
    });
    expect(byInvitation["inv-expired"]).toMatchObject({
      kind: "create",
      slotKey: "__ambiguous__",
      userId: null,
      identityAmbiguous: true,
    });
  });

  it("reuses existing participant from dual-write rows when merging", () => {
    const plan = planBackfillForEmailGroup("reuse@example.test", [
      row("inv-old", { participantId: "participant-existing" }),
      row("inv-new"),
    ]);

    expect(plan!.assignments).toHaveLength(1);
    expect(plan!.assignments[0].target).toMatchObject({
      kind: "existing",
      participantId: "participant-existing",
    });
    expect(plan!.mergeParticipantIds).toHaveLength(0);
  });

  it("plans merges when dual-write created multiple participants for one email", () => {
    const plan = planBackfillForEmailGroup("merge@example.test", [
      row("inv-1", { participantId: "participant-a" }),
      row("inv-2", { participantId: "participant-b" }),
      row("inv-3"),
    ]);

    expect(plan!.assignments[0].target).toMatchObject({
      kind: "existing",
      participantId: "participant-a",
    });
    expect(plan!.mergeParticipantIds).toEqual([
      { survivorId: "participant-a", mergedAwayId: "participant-b" },
    ]);
  });

  it("marks pre-existing ambiguous dual-write participants during split", () => {
    const plan = planBackfillForEmailGroup("split-existing@example.test", [
      row("inv-a", {
        participantId: "participant-a",
        acceptedAt: new Date(),
        acceptedByUserId: "user-a",
      }),
      row("inv-b", {
        acceptedAt: new Date(),
        acceptedByUserId: "user-b",
      }),
      row("inv-orphan", { participantId: "participant-orphan" }),
      row("inv-pending"),
    ]);

    expect(plan!.markAmbiguousParticipantIds).toContain("participant-orphan");
    expect(plan!.assignments.find((a) => a.invitationId === "inv-pending")?.target).toMatchObject({
      kind: "existing",
      participantId: "participant-orphan",
      identityAmbiguous: true,
    });
  });
});
