/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  AttemptAuditDetails,
  formatOperatorLabel,
  ParticipantCard,
} from "./ParticipantList";
import type { BetaParticipantListItem } from "@/app/src/lib/platform/betaParticipants";

const mockFetchPriorAttempts = vi.fn();

vi.mock("./actions", () => ({
  fetchPriorAttemptsAction: (...args: unknown[]) => mockFetchPriorAttempts(...args),
}));

vi.mock("./InvitationActions", () => ({
  InvitationActions: () => createElement("div", null, "Actions"),
  InvitationCardActions: () => createElement("div", null, "Card Actions"),
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function buildAttempt(
  overrides: Partial<BetaParticipantListItem["latestAttempt"]> = {},
): BetaParticipantListItem["latestAttempt"] {
  return {
    id: "inv-latest",
    email: "latest@example.test",
    code: "ABC-DEF",
    token: "tok",
    inviteUrl: "https://example.com/redeem/tok",
    status: "pending",
    campaign: "Wave 1",
    notes: "Latest notes",
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
    ...overrides,
  };
}

function buildParticipant(
  overrides: Partial<BetaParticipantListItem> = {},
): BetaParticipantListItem {
  return {
    participantId: "p1",
    identityAmbiguous: false,
    displayName: "Tester",
    currentEmail: "tester@example.test",
    wave: "Wave 1",
    journeyStage: "invited",
    attentionReason: null,
    attentionSince: null,
    allianceAmbiguous: false,
    allianceId: null,
    allianceName: null,
    priorAttemptCount: 17,
    latestAttempt: buildAttempt(),
    ...overrides,
  };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mockFetchPriorAttempts.mockReset();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

describe("formatOperatorLabel", () => {
  it("shows unknown legacy when attribution is missing", () => {
    expect(formatOperatorLabel(null, "Issued by")).toBe(
      "Issued by: Unknown (legacy)",
    );
    expect(
      formatOperatorLabel({ userId: null, displayName: null, email: null }, "Revoked by"),
    ).toBe("Revoked by: Unknown (legacy)");
  });

  it("prefers display name for attributed operators", () => {
    expect(
      formatOperatorLabel(
        {
          userId: "u1",
          displayName: "Operator One",
          email: "operator@example.test",
        },
        "Issued by",
      ),
    ).toBe("Issued by: Operator One");
  });
});

describe("AttemptAuditDetails", () => {
  it("renders lifecycle timestamps, notes, and attribution", async () => {
    await act(async () => {
      root.render(
        createElement(AttemptAuditDetails, {
          attempt: buildAttempt({
            status: "revoked",
            revokedAt: new Date("2026-07-10T12:00:00Z"),
            revokedBy: {
              userId: "op-2",
              displayName: "Revoker",
              email: "revoker@example.test",
            },
            notes: "Prior attempt notes",
          }),
        }),
      );
    });

    expect(container.textContent).toContain("Prior attempt notes");
    expect(container.textContent).toContain("Issued by: Operator One");
    expect(container.textContent).toContain("Revoked by: Revoker");
    expect(container.textContent).toContain("Expires");
    expect(container.textContent).toContain("Revoked");
  });
});

describe("ParticipantCard prior attempts pagination", () => {
  it("loads every prior attempt page through next controls", async () => {
    const attempts = Array.from({ length: 17 }, (_, index) => ({
      id: `prior-${index + 1}`,
      email: `prior-${index + 1}@example.test`,
      code: `CODE-${index + 1}`,
      status: "revoked" as const,
      campaign: "Wave 1",
      notes: `Attempt ${index + 1}`,
      issuedAt: new Date(`2026-06-${String(index + 1).padStart(2, "0")}T12:00:00Z`),
      createdAt: new Date(`2026-06-${String(index + 1).padStart(2, "0")}T12:00:00Z`),
      expiresAt: new Date("2026-08-01T12:00:00Z"),
      acceptedAt: null,
      revokedAt: new Date("2026-07-01T12:00:00Z"),
      issuedBy: null,
      revokedBy: null,
      acceptedBy: null,
    }));

    mockFetchPriorAttempts.mockImplementation(
      async (_participantId: string, page: number) => ({
        success: true,
        items: attempts.slice((page - 1) * 10, page * 10),
        total: attempts.length,
        page,
        pageSize: 10,
      }),
    );

    await act(async () => {
      root.render(createElement(ParticipantCard, { item: buildParticipant() }));
    });

    const toggle = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Show 17 prior attempts"),
    );
    expect(toggle).toBeTruthy();

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(mockFetchPriorAttempts).toHaveBeenCalledWith("p1", 1, 10);
    expect(container.textContent).toContain("Attempt 1");
    expect(container.textContent).not.toContain("Attempt 17");

    const nextButton = Array.from(container.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("Next"),
    );

    await act(async () => {
      nextButton?.click();
      await Promise.resolve();
    });

    expect(mockFetchPriorAttempts).toHaveBeenCalledWith("p1", 2, 10);
    expect(container.textContent).toContain("Attempt 11");
    expect(container.textContent).toContain("Attempt 17");
    expect(container.textContent).toContain("Page 2 of 2");
  });
});
