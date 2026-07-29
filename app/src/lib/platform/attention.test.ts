import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  getActionRequired,
  getActionRequiredBySeverity,
  mapBetaParticipantToActionRequired,
} from "./attention";
import type { BetaParticipantAttentionRow } from "./betaParticipants";

vi.mock("../prisma", () => ({
  prisma: {
    invitation: { findMany: vi.fn() },
    alliance: { findMany: vi.fn() },
  },
}));

vi.mock("./betaParticipants", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./betaParticipants")>();
  return {
    ...actual,
    listBetaParticipantsNeedingAttention: vi.fn(),
  };
});

import { prisma } from "../prisma";
import { listBetaParticipantsNeedingAttention } from "./betaParticipants";

function buildParticipant(
  overrides: Partial<BetaParticipantAttentionRow> = {},
): BetaParticipantAttentionRow {
  return {
    participantId: "participant-1",
    identityAmbiguous: false,
    displayName: null,
    currentEmail: null,
    latestAttemptEmail: "beta@example.test",
    attentionReason: "invitation_expired",
    attentionSince: new Date("2026-07-20T12:00:00Z"),
    allianceAmbiguous: false,
    allianceId: null,
    allianceName: null,
    ...overrides,
  };
}

describe("mapBetaParticipantToActionRequired", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  it("maps accepted_no_alliance to critical with beta list deep link", () => {
    const item = mapBetaParticipantToActionRequired(
      buildParticipant({
        attentionReason: "accepted_no_alliance",
        attentionSince: new Date("2026-07-20T12:00:00Z"),
      }),
      now,
    );

    expect(item.severity).toBe("critical");
    expect(item.title).toBe("Accepted beta, no alliance");
    expect(item.description).toBe("beta@example.test accepted 9 days ago");
    expect(item.href).toBe("/platform/beta?attentionReason=accepted_no_alliance");
    expect(item.metadata?.participantId).toBe("participant-1");
  });

  it("maps invitation_expired to warning with filter href", () => {
    const item = mapBetaParticipantToActionRequired(buildParticipant(), now);

    expect(item.severity).toBe("warning");
    expect(item.title).toBe("Expired beta invitation");
    expect(item.description).toBe("beta@example.test expired 9d ago");
    expect(item.href).toBe("/platform/beta?attentionReason=invitation_expired");
  });

  it("maps invitation_pending_stale to warning", () => {
    const item = mapBetaParticipantToActionRequired(
      buildParticipant({
        attentionReason: "invitation_pending_stale",
        attentionSince: new Date("2026-07-20T12:00:00Z"),
      }),
      now,
    );

    expect(item.severity).toBe("warning");
    expect(item.href).toBe(
      "/platform/beta?attentionReason=invitation_pending_stale",
    );
    expect(item.description).toBe("beta@example.test pending 9d");
  });

  it("maps setup_stalled to support detail when alliance is known and unambiguous", () => {
    const item = mapBetaParticipantToActionRequired(
      buildParticipant({
        attentionReason: "setup_stalled",
        attentionSince: new Date("2026-07-20T12:00:00Z"),
        allianceId: "alliance-1",
        allianceName: "Stalled Alliance",
      }),
      now,
    );

    expect(item.severity).toBe("warning");
    expect(item.title).toBe("Stalled Alliance setup stalled");
    expect(item.href).toBe("/platform/support/alliance/alliance-1");
    expect(item.allianceId).toBe("alliance-1");
  });

  it("maps setup_stalled to beta list when alliance is ambiguous", () => {
    const item = mapBetaParticipantToActionRequired(
      buildParticipant({
        attentionReason: "setup_stalled",
        attentionSince: new Date("2026-07-20T12:00:00Z"),
        allianceAmbiguous: true,
        allianceId: null,
      }),
      now,
    );

    expect(item.href).toBe("/platform/beta?attentionReason=setup_stalled");
  });

  it("prefers displayName and currentEmail for identity", () => {
    const item = mapBetaParticipantToActionRequired(
      buildParticipant({
        displayName: "Beta Tester",
        currentEmail: "current@example.test",
      }),
      now,
    );

    expect(item.description).toContain("Beta Tester");
  });
});

describe("getActionRequired beta isolation", () => {
  const now = new Date("2026-07-29T12:00:00Z");

  beforeEach(() => {
    vi.mocked(prisma.invitation.findMany).mockResolvedValue([]);
    vi.mocked(prisma.alliance.findMany).mockResolvedValue([
      {
        id: "alliance-no-metrics",
        name: "Recent Alliance",
        createdAt: new Date("2026-07-25T12:00:00Z"),
      },
    ] as never);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("returns non-beta items when beta attention query throws", async () => {
    vi.mocked(listBetaParticipantsNeedingAttention).mockRejectedValue(
      new Error("beta query failed"),
    );

    const items = await getActionRequired(now);

    expect(items).toHaveLength(1);
    expect(items[0]?.id).toBe("no-metrics-alliance-no-metrics");
  });

  it("flags betaAttentionUnavailable without silently reporting zero beta items", async () => {
    vi.mocked(listBetaParticipantsNeedingAttention).mockRejectedValue(
      new Error("beta query failed"),
    );

    const grouped = await getActionRequiredBySeverity(now);

    expect(grouped.betaAttentionUnavailable).toBe(true);
    expect(grouped.info).toHaveLength(1);
    expect(grouped.totalCount).toBe(1);
  });

  it("recovers beta items when the query succeeds after a prior failure", async () => {
    vi.mocked(listBetaParticipantsNeedingAttention)
      .mockRejectedValueOnce(new Error("beta query failed"))
      .mockResolvedValueOnce([
        buildParticipant({ participantId: "participant-recovered" }),
      ]);

    const failed = await getActionRequiredBySeverity(now);
    expect(failed.betaAttentionUnavailable).toBe(true);
    expect(failed.warning).toHaveLength(0);

    const recovered = await getActionRequiredBySeverity(now);
    expect(recovered.betaAttentionUnavailable).toBe(false);
    expect(recovered.warning).toHaveLength(1);
    expect(recovered.warning[0]?.id).toBe("beta-attention-participant-recovered");
  });
});
