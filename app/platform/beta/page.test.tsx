import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) =>
    React.createElement("a", { href, ...props }, children),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("./InviteBetaTester", () => ({
  InviteBetaTester: () => React.createElement("div", null, "Invite Beta Tester"),
}));

vi.mock("./ParticipantFilters", () => ({
  ParticipantFilters: () => React.createElement("div", null, "Filters"),
}));

vi.mock("./ParticipantList", () => ({
  ParticipantCard: ({ item }: { item: { participantId: string } }) =>
    React.createElement("div", null, `Card ${item.participantId}`),
  ParticipantTableRow: ({ item }: { item: { participantId: string } }) =>
    React.createElement("tr", null, React.createElement("td", null, item.participantId)),
  journeyStageLabels: {},
  attentionLabels: {},
}));

vi.mock("@/app/src/lib/platform/betaParticipants", () => ({
  listBetaParticipants: vi.fn(),
  boundBetaParticipantsInput: (v: string) => v,
}));

vi.mock("@/app/src/lib/platform/accessRequestInbox", () => ({
  listAccessRequestsForTriage: vi.fn(),
}));

import { listBetaParticipants } from "@/app/src/lib/platform/betaParticipants";
import { listAccessRequestsForTriage } from "@/app/src/lib/platform/accessRequestInbox";
import PlatformBeta from "./page";

const EMPTY_STATUS_COUNTS = {
  PENDING: 0,
  INVITED: 0,
  DECLINED: 0,
  RESOLVED_EXISTING_ACCESS: 0,
};

describe("PlatformBeta page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listAccessRequestsForTriage).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 1,
      statusCounts: { ...EMPTY_STATUS_COUNTS, PENDING: 3 },
    });
  });

  it("renders participant-centric summary cards and list", async () => {
    vi.mocked(listBetaParticipants).mockResolvedValue({
      items: [
        {
          participantId: "p1",
          identityAmbiguous: true,
          displayName: "Tester",
          currentEmail: "tester@example.com",
          wave: "Wave 1",
          journeyStage: "invited",
          attentionReason: "invitation_pending_stale",
          attentionSince: new Date("2026-07-20T12:00:00Z"),
          allianceAmbiguous: false,
          allianceId: null,
          allianceName: null,
          priorAttemptCount: 2,
          latestAttempt: {
            id: "inv1",
            email: "tester@example.com",
            code: "ABC-DEF",
            token: "tok",
            inviteUrl: "https://example.com/redeem/tok",
            status: "pending",
            campaign: "Wave 1",
            notes: null,
            issuedAt: new Date("2026-07-01T12:00:00Z"),
            createdAt: new Date("2026-07-01T12:00:00Z"),
            expiresAt: new Date("2026-08-01T12:00:00Z"),
            acceptedAt: null,
            revokedAt: null,
            issuedBy: {
              userId: "op-1",
              displayName: "Operator One",
              email: "operator@example.test",
            },
            revokedBy: null,
            acceptedBy: null,
            latestDeliveryAttempt: null,
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      summary: {
        totalParticipants: 1,
        totalInvitationAttempts: 3,
        acceptedParticipants: 0,
        needsAttention: 1,
        distinctAlliancesCreated: 0,
        distinctAlliancesSetupComplete: 0,
      },
    });

    const page = await PlatformBeta({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Beta Participants");
    expect(html).toContain("Invitation attempts");
    expect(html).toContain("Accepted");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Alliances created");
    expect(html).toContain("Setup complete");
    expect(html).toContain("Card p1");
    expect(html).toContain("p1");

    // Access-request discovery card (#177 design decision): links through
    // to the queue and shows the exact pending count when available.
    expect(html).toContain("Access requests");
    expect(html).toContain('href="/platform/beta/access-requests"');
    expect(html).toContain(">3<");
  });

  it("renders the access-request discovery card without a count when the queue is unavailable", async () => {
    vi.mocked(listAccessRequestsForTriage).mockRejectedValue(new Error("db down"));
    vi.mocked(listBetaParticipants).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      summary: {
        totalParticipants: 0,
        totalInvitationAttempts: 0,
        acceptedParticipants: 0,
        needsAttention: 0,
        distinctAlliancesCreated: 0,
        distinctAlliancesSetupComplete: 0,
      },
    });

    const page = await PlatformBeta({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Access requests");
    expect(html).toContain('href="/platform/beta/access-requests"');
    // No pending-count figure rendered when the snapshot query fails —
    // the card still links through, it just omits the number.
    expect(html).not.toContain("Pending");
  });

  it("renders empty state when no participants match", async () => {
    vi.mocked(listBetaParticipants).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      summary: {
        totalParticipants: 0,
        totalInvitationAttempts: 0,
        acceptedParticipants: 0,
        needsAttention: 0,
        distinctAlliancesCreated: 0,
        distinctAlliancesSetupComplete: 0,
      },
    });

    const page = await PlatformBeta({ searchParams: Promise.resolve({ search: "none" }) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("No beta participants match these filters");
    expect(html).toContain('href="/platform/beta"');
  });
});
