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

import { listBetaParticipants } from "@/app/src/lib/platform/betaParticipants";
import PlatformBeta from "./page";

describe("PlatformBeta page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
          },
        },
      ],
      total: 1,
      page: 1,
      pageSize: 25,
      summary: {
        totalParticipants: 1,
        needsAttention: 1,
        distinctAlliancesCreated: 0,
        distinctAlliancesSetupComplete: 0,
      },
    });

    const page = await PlatformBeta({ searchParams: Promise.resolve({}) });
    const html = renderToStaticMarkup(page);

    expect(html).toContain("Beta Participants");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Alliances created");
    expect(html).toContain("Setup complete");
    expect(html).toContain("Card p1");
    expect(html).toContain("p1");
  });

  it("renders empty state when no participants match", async () => {
    vi.mocked(listBetaParticipants).mockResolvedValue({
      items: [],
      total: 0,
      page: 1,
      pageSize: 25,
      summary: {
        totalParticipants: 0,
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
