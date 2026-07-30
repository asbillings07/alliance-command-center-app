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
const mockFetchDeliveryHistory = vi.fn();

vi.mock("./actions", () => ({
  fetchPriorAttemptsAction: (...args: unknown[]) => mockFetchPriorAttempts(...args),
  fetchDeliveryHistoryAction: (...args: unknown[]) =>
    mockFetchDeliveryHistory(...args),
}));

vi.mock("./InvitationActions", () => ({
  InvitationActions: () => createElement("div", null, "Actions"),
  InvitationCardActions: () => createElement("div", null, "Card Actions"),
}));

vi.mock("./ReissueActions", () => ({
  ReissueActions: ({ variant }: { variant: string }) =>
    createElement("div", { "data-testid": "reissue-actions" }, `Reissue ${variant}`),
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
    latestDeliveryAttempt: null,
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
  mockFetchDeliveryHistory.mockReset();
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

  it("shows reissue actions for terminal latest attempts", async () => {
    await act(async () => {
      root.render(
        createElement(ParticipantCard, {
          item: buildParticipant({
            latestAttempt: buildAttempt({
              status: "revoked",
              revokedAt: new Date("2026-07-10T12:00:00Z"),
            }),
          }),
        }),
      );
    });

    expect(container.querySelector('[data-testid="reissue-actions"]')).toBeTruthy();
  });

  it("does not show reissue actions for pending latest attempts", async () => {
    await act(async () => {
      root.render(createElement(ParticipantCard, { item: buildParticipant() }));
    });

    expect(container.querySelector('[data-testid="reissue-actions"]')).toBeNull();
  });
});

describe("email delivery status (#175)", () => {
  it("renders 'Not recorded' when no delivery attempt exists, distinct from invitation lifecycle status", async () => {
    await act(async () => {
      root.render(
        createElement(AttemptAuditDetails, {
          attempt: buildAttempt({ latestDeliveryAttempt: null }),
        }),
      );
    });

    expect(container.textContent).toContain("Email:");
    expect(container.textContent).toContain("Not recorded");
    // No delivery history toggle when nothing has ever been recorded.
    const toggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("delivery history"),
    );
    expect(toggle).toBeUndefined();
  });

  it("renders a Sent badge with trigger, timestamp, attempted-by actor, and provider message ID", async () => {
    await act(async () => {
      root.render(
        createElement(AttemptAuditDetails, {
          attempt: buildAttempt({
            latestDeliveryAttempt: {
              id: "att-1",
              trigger: "issue",
              status: "sent",
              createdAt: new Date("2026-07-30T12:00:00Z"),
              failureReason: null,
              providerMessageId: "msg-1",
              attemptedBy: {
                userId: "op-1",
                displayName: "Operator One",
                email: "operator@example.test",
              },
            },
          }),
        }),
      );
    });

    expect(container.textContent).toContain("Sent");
    expect(container.textContent).toContain("Initial send");
    expect(container.textContent).toContain("By: Operator One");
    // [P1 review]: provider IDs are platform-operator-only and SENT-only —
    // this is the focused positive assertion for that surface.
    expect(container.textContent).toContain("msg-1");
  });

  it("does not render a provider message ID for a non-SENT delivery, even if one were present", async () => {
    await act(async () => {
      root.render(
        createElement(AttemptAuditDetails, {
          attempt: buildAttempt({
            latestDeliveryAttempt: {
              id: "att-2",
              trigger: "resend",
              status: "failed",
              createdAt: new Date("2026-07-30T12:00:00Z"),
              failureReason: "Provider rejected the request",
              // A FAILED row should never actually carry a providerMessageId
              // (canonicalization mapping in betaInvitationDelivery.ts), but
              // the UI must not render one even if the read model somehow
              // returned it — this is the negative/absence assertion.
              providerMessageId: "should-not-render",
              attemptedBy: {
                userId: "op-2",
                displayName: "Operator Two",
                email: "operator2@example.test",
              },
            },
          }),
        }),
      );
    });

    expect(container.textContent).toContain("Failed");
    expect(container.textContent).toContain("Resend");
    expect(container.textContent).toContain("Provider rejected the request");
    expect(container.textContent).toContain("By: Operator Two");
    expect(container.textContent).not.toContain("should-not-render");
  });

  it("renders a Skipped badge without a failure reason", async () => {
    await act(async () => {
      root.render(
        createElement(AttemptAuditDetails, {
          attempt: buildAttempt({
            latestDeliveryAttempt: {
              id: "att-3",
              trigger: "reissue",
              status: "skipped",
              createdAt: new Date("2026-07-30T12:00:00Z"),
              failureReason: null,
              providerMessageId: null,
              attemptedBy: {
                userId: "op-3",
                displayName: "Operator Three",
                email: "operator3@example.test",
              },
            },
          }),
        }),
      );
    });

    expect(container.textContent).toContain("Skipped");
    expect(container.textContent).toContain("Reissue");
  });

  it("retains the snapshotted email as the attempted-by actor after the operator account is deleted", async () => {
    await act(async () => {
      root.render(
        createElement(AttemptAuditDetails, {
          attempt: buildAttempt({
            latestDeliveryAttempt: {
              id: "att-4",
              trigger: "issue",
              status: "sent",
              createdAt: new Date("2026-07-30T12:00:00Z"),
              failureReason: null,
              providerMessageId: "msg-4",
              // userId nulled (onDelete: SetNull) but the snapshot survives.
              attemptedBy: {
                userId: null,
                displayName: "Deleted Operator",
                email: "deleted-operator@example.test",
              },
            },
          }),
        }),
      );
    });

    expect(container.textContent).toContain("By: Deleted Operator");
  });

  it("falls back to 'Unknown (legacy)' only in the defensive case of a fully-missing attempted-by actor", async () => {
    await act(async () => {
      root.render(
        createElement(AttemptAuditDetails, {
          attempt: buildAttempt({
            latestDeliveryAttempt: {
              id: "att-5",
              trigger: "issue",
              status: "sent",
              createdAt: new Date("2026-07-30T12:00:00Z"),
              failureReason: null,
              providerMessageId: "msg-5",
              attemptedBy: null,
            },
          }),
        }),
      );
    });

    expect(container.textContent).toContain("By: Unknown (legacy)");
  });
});

describe("DeliveryHistoryDisclosure (#175)", () => {
  function buildLatestAttemptWithDelivery() {
    return buildAttempt({
      id: "inv-latest",
      latestDeliveryAttempt: {
        id: "att-latest",
        trigger: "issue",
        status: "sent",
        createdAt: new Date("2026-07-30T12:00:00Z"),
        failureReason: null,
        providerMessageId: "msg-latest",
        attemptedBy: {
          userId: "op-1",
          displayName: "Operator One",
          email: "operator@example.test",
        },
      },
    });
  }

  it("lazy-loads and paginates delivery history only after the toggle is clicked", async () => {
    const items = [
      {
        id: "att-2",
        trigger: "resend" as const,
        status: "sent" as const,
        createdAt: new Date("2026-07-15T12:00:00Z"),
        failureReason: null,
        providerMessageId: "msg-2",
        attemptedBy: {
          userId: "op-2",
          displayName: "Operator Two",
          email: "operator2@example.test",
        },
      },
      {
        id: "att-1",
        trigger: "issue" as const,
        status: "failed" as const,
        createdAt: new Date("2026-07-01T12:00:00Z"),
        failureReason: "Older failure",
        providerMessageId: null,
        attemptedBy: null,
      },
    ];

    mockFetchDeliveryHistory.mockImplementation(
      async (_invitationId: string, page: number, pageSize: number) => ({
        success: true,
        items: items.slice((page - 1) * pageSize, page * pageSize),
        total: items.length,
        page,
        pageSize,
      }),
    );

    await act(async () => {
      root.render(
        createElement(ParticipantCard, {
          item: buildParticipant({
            latestAttempt: buildLatestAttemptWithDelivery(),
          }),
        }),
      );
    });

    expect(mockFetchDeliveryHistory).not.toHaveBeenCalled();

    const toggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Show email delivery history",
    );
    expect(toggle).toBeTruthy();

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(mockFetchDeliveryHistory).toHaveBeenCalledWith("inv-latest", 1, 10);
    expect(container.textContent).toContain("Older failure");

    const hideToggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Hide email delivery history",
    );
    expect(hideToggle).toBeTruthy();
  });

  it("shows the 'Not recorded' fallback for an empty history page rather than nothing", async () => {
    mockFetchDeliveryHistory.mockResolvedValue({
      success: true,
      items: [],
      total: 0,
      page: 1,
      pageSize: 10,
    });

    await act(async () => {
      root.render(
        createElement(ParticipantCard, {
          item: buildParticipant({
            latestAttempt: buildLatestAttemptWithDelivery(),
          }),
        }),
      );
    });

    const toggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Show email delivery history",
    );

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Not recorded");
  });

  it("surfaces a load error without crashing", async () => {
    mockFetchDeliveryHistory.mockResolvedValue({
      success: false,
      error: "Failed to load delivery history",
    });

    await act(async () => {
      root.render(
        createElement(ParticipantCard, {
          item: buildParticipant({
            latestAttempt: buildLatestAttemptWithDelivery(),
          }),
        }),
      );
    });

    const toggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Show email delivery history",
    );

    await act(async () => {
      toggle?.click();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Failed to load delivery history");
  });

  it("does not render a history toggle at all when nothing has ever been recorded", async () => {
    await act(async () => {
      root.render(
        createElement(ParticipantCard, {
          item: buildParticipant({
            latestAttempt: buildAttempt({ latestDeliveryAttempt: null }),
          }),
        }),
      );
    });

    const toggle = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent?.includes("delivery history"),
    );
    expect(toggle).toBeUndefined();
  });
});
