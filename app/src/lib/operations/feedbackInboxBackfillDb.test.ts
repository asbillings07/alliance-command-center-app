import { describe, it, expect } from "vitest";
import {
  planFeedbackInboxBackfill,
  verifyFeedbackInboxBackfillManifestForExecute,
  buildFeedbackInboxBackfillManifest,
  feedbackInboxBackfillManifestChecksumPayload,
  type FeedbackInboxBackfillRow,
} from "./feedbackInboxBackfillDb";

describe("feedbackInboxBackfillDb", () => {
  const baseRow = {
    userId: "user1",
    submitterEmail: "user@example.test",
    submitterDisplayName: "User One",
    userEmail: "user@example.test",
    userDisplayName: "User One",
  };

  const rows: FeedbackInboxBackfillRow[] = [
    {
      id: "fb1",
      url: "/alliances/a1/members",
      allianceId: null,
      hasTriage: false,
      ...baseRow,
    },
    {
      id: "fb2",
      url: "/platform/overview",
      allianceId: null,
      hasTriage: true,
      ...baseRow,
    },
    {
      id: "fb3",
      url: "/alliances/a2/import",
      allianceId: "a2",
      hasTriage: true,
      ...baseRow,
    },
  ];

  it("plans alliance updates and triage creates idempotently", () => {
    const plan = planFeedbackInboxBackfill(rows);
    expect(plan.allianceUpdates).toEqual([{ id: "fb1", allianceId: "a1" }]);
    expect(plan.submitterSnapshotUpdates).toEqual([]);
    expect(plan.triageCreates).toEqual(["fb1"]);
    expect(plan.summary).toEqual({
      allianceIdUpdates: 1,
      allianceIdSkippedAlreadySet: 1,
      allianceIdSkippedNoSegment: 1,
      submitterSnapshotUpdates: 0,
      submitterSnapshotSkippedAlreadySet: 3,
      submitterSnapshotSkippedNoUser: 0,
      triageProjectionsCreated: 1,
      triageProjectionsSkippedExisting: 2,
    });
  });

  it("plans submitter snapshot updates for overlap-window rows", () => {
    const plan = planFeedbackInboxBackfill([
      {
        id: "fb-overlap",
        url: "/platform/overview",
        allianceId: "alliance-a",
        hasTriage: true,
        userId: "user-live",
        submitterEmail: null,
        submitterDisplayName: null,
        userEmail: "overlap@example.test",
        userDisplayName: "Overlap User",
      },
    ]);
    expect(plan.submitterSnapshotUpdates).toEqual([
      {
        id: "fb-overlap",
        submitterEmail: "overlap@example.test",
        submitterDisplayName: "Overlap User",
      },
    ]);
    expect(plan.summary.submitterSnapshotSkippedAlreadySet).toBe(0);
    expect(plan.summary.submitterSnapshotSkippedNoUser).toBe(0);
  });

  it("second plan on already-handled rows produces zero work", () => {
    const handled: FeedbackInboxBackfillRow[] = [
      {
        id: "fb1",
        url: "/alliances/a1/members",
        allianceId: "a1",
        hasTriage: true,
        ...baseRow,
      },
      {
        id: "fb2",
        url: "/platform/overview",
        allianceId: null,
        hasTriage: true,
        ...baseRow,
      },
    ];
    const plan = planFeedbackInboxBackfill(handled);
    expect(plan.allianceUpdates).toEqual([]);
    expect(plan.triageCreates).toEqual([]);
    expect(plan.summary.allianceIdSkippedNoSegment).toBe(1);
  });

  it("verifyFeedbackInboxBackfillManifestForExecute allows idempotent re-run after plan is satisfied", () => {
    const rows: FeedbackInboxBackfillRow[] = [
      {
        id: "fb1",
        url: "/alliances/a1/members",
        allianceId: "a1",
        hasTriage: true,
        ...baseRow,
      },
    ];
    const originalPlan = planFeedbackInboxBackfill([
      {
        id: "fb1",
        url: "/alliances/a1/members",
        allianceId: null,
        hasTriage: false,
        ...baseRow,
      },
    ]);
    const manifest = buildFeedbackInboxBackfillManifest({
      dbIdentity: "ep-preview-999999",
      totalFeedbackRows: 1,
      plan: originalPlan,
    });
    const freshPlan = planFeedbackInboxBackfill(rows);
    expect(
      verifyFeedbackInboxBackfillManifestForExecute(
        manifest,
        {
          dbIdentity: "ep-preview-999999",
          payload: feedbackInboxBackfillManifestChecksumPayload({
            dbIdentity: "ep-preview-999999",
            totalFeedbackRows: 1,
            plan: freshPlan,
          }),
        },
        rows,
      ).ok,
    ).toBe(true);
  });
});
