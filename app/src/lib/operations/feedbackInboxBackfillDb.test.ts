import { describe, it, expect } from "vitest";
import {
  planFeedbackInboxBackfill,
  verifyFeedbackInboxBackfillManifestForExecute,
  buildFeedbackInboxBackfillManifest,
  feedbackInboxBackfillManifestChecksumPayload,
  type FeedbackInboxBackfillRow,
} from "./feedbackInboxBackfillDb";

describe("feedbackInboxBackfillDb", () => {
  const rows: FeedbackInboxBackfillRow[] = [
    {
      id: "fb1",
      url: "/alliances/a1/members",
      allianceId: null,
      hasTriage: false,
    },
    {
      id: "fb2",
      url: "/platform/overview",
      allianceId: null,
      hasTriage: true,
    },
    {
      id: "fb3",
      url: "/alliances/a2/import",
      allianceId: "a2",
      hasTriage: true,
    },
  ];

  it("plans alliance updates and triage creates idempotently", () => {
    const plan = planFeedbackInboxBackfill(rows);
    expect(plan.allianceUpdates).toEqual([{ id: "fb1", allianceId: "a1" }]);
    expect(plan.triageCreates).toEqual(["fb1"]);
    expect(plan.summary).toEqual({
      allianceIdUpdates: 1,
      allianceIdSkippedAlreadySet: 1,
      allianceIdSkippedNoSegment: 1,
      triageProjectionsCreated: 1,
      triageProjectionsSkippedExisting: 2,
    });
  });

  it("second plan on already-handled rows produces zero work", () => {
    const handled: FeedbackInboxBackfillRow[] = [
      {
        id: "fb1",
        url: "/alliances/a1/members",
        allianceId: "a1",
        hasTriage: true,
      },
      {
        id: "fb2",
        url: "/platform/overview",
        allianceId: null,
        hasTriage: true,
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
      },
    ];
    const originalPlan = planFeedbackInboxBackfill([
      {
        id: "fb1",
        url: "/alliances/a1/members",
        allianceId: null,
        hasTriage: false,
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
