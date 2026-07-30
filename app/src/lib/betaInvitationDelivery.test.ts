import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  sanitizeDeliveryFailureReason,
  boundProviderMessageId,
  recordBetaInvitationDeliveryAttempt,
  GENERIC_DELIVERY_FAILURE_REASON,
} from "./betaInvitationDelivery";
import type { EmailResult } from "./email/types";

vi.mock("./prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    betaInvitationDeliveryAttempt: {
      create: vi.fn(),
    },
  },
}));

import { prisma } from "./prisma";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  betaInvitationDeliveryAttempt: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({
    email: "admin@example.com",
    displayName: "Admin User",
  });
  mockPrisma.betaInvitationDeliveryAttempt.create.mockResolvedValue({});
});

describe("sanitizeDeliveryFailureReason", () => {
  it("returns null for undefined/null/empty input", () => {
    expect(sanitizeDeliveryFailureReason(undefined)).toBeNull();
    expect(sanitizeDeliveryFailureReason(null)).toBeNull();
    expect(sanitizeDeliveryFailureReason("")).toBeNull();
  });

  it("strips control characters and newlines", () => {
    expect(sanitizeDeliveryFailureReason("line one\nline two\ttab")).toBe(
      "line one line two tab",
    );
  });

  it("trims surrounding whitespace", () => {
    expect(sanitizeDeliveryFailureReason("  provider rejected  ")).toBe(
      "provider rejected",
    );
  });

  it("returns null when the cleaned result is empty (whitespace/control-only input)", () => {
    expect(sanitizeDeliveryFailureReason("\n\t  \u0000")).toBeNull();
  });

  it("truncates to 300 characters", () => {
    const long = "x".repeat(400);
    const result = sanitizeDeliveryFailureReason(long);
    expect(result).toHaveLength(300);
    expect(result).toBe("x".repeat(300));
  });
});

describe("boundProviderMessageId", () => {
  it("returns null for undefined/null/empty input", () => {
    expect(boundProviderMessageId(undefined)).toBeNull();
    expect(boundProviderMessageId(null)).toBeNull();
    expect(boundProviderMessageId("")).toBeNull();
  });

  it("trims surrounding whitespace", () => {
    expect(boundProviderMessageId("  msg-123  ")).toBe("msg-123");
  });

  it("truncates an over-200-character provider id and persists the bounded value", () => {
    const long = "m".repeat(250);
    const result = boundProviderMessageId(long);
    expect(result).toHaveLength(200);
    expect(result).toBe("m".repeat(200));
  });
});

describe("recordBetaInvitationDeliveryAttempt", () => {
  const baseParams = {
    invitationId: "inv-1",
    attemptedByUserId: "admin-1",
    requestId: "req-1",
  };

  it("persists a SENT result with its provider message id and no failure reason", async () => {
    const result: EmailResult = { status: "sent", messageId: "msg-abc" };

    await recordBetaInvitationDeliveryAttempt({
      ...baseParams,
      trigger: "issue",
      result,
    });

    expect(mockPrisma.betaInvitationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        invitationId: "inv-1",
        trigger: "ISSUE",
        status: "SENT",
        providerMessageId: "msg-abc",
        failureReason: null,
        attemptedByUserId: "admin-1",
        attemptedByEmail: "admin@example.com",
        attemptedByDisplayName: "Admin User",
        requestId: "req-1",
      }),
    });
  });

  it("persists a FAILED result with a sanitized failure reason and no provider id", async () => {
    const result: EmailResult = {
      status: "failed",
      error: "Provider rejected\nthe request",
    };

    await recordBetaInvitationDeliveryAttempt({
      ...baseParams,
      trigger: "resend",
      result,
    });

    expect(mockPrisma.betaInvitationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        trigger: "RESEND",
        status: "FAILED",
        providerMessageId: null,
        failureReason: "Provider rejected the request",
      }),
    });
  });

  it("persists a SKIPPED result with no failure reason and no provider id", async () => {
    const result: EmailResult = { status: "skipped" };

    await recordBetaInvitationDeliveryAttempt({
      ...baseParams,
      trigger: "reissue",
      result,
    });

    expect(mockPrisma.betaInvitationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        trigger: "REISSUE",
        status: "SKIPPED",
        providerMessageId: null,
        failureReason: null,
      }),
    });
  });

  it("canonicalization: a FAILED result with no error string persists using the generic fallback reason", async () => {
    const result: EmailResult = { status: "failed" };

    await recordBetaInvitationDeliveryAttempt({
      ...baseParams,
      trigger: "issue",
      result,
    });

    expect(mockPrisma.betaInvitationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "FAILED",
        failureReason: GENERIC_DELIVERY_FAILURE_REASON,
      }),
    });
  });

  it("canonicalization: an over-200-character provider id is truncated and persists", async () => {
    const result: EmailResult = { status: "sent", messageId: "m".repeat(250) };

    await recordBetaInvitationDeliveryAttempt({
      ...baseParams,
      trigger: "issue",
      result,
    });

    const call = mockPrisma.betaInvitationDeliveryAttempt.create.mock.calls[0][0];
    expect(call.data.providerMessageId).toHaveLength(200);
  });

  it("canonicalization: a non-SENT outcome discards any unexpected provider id", async () => {
    // Not a real transport shape, but the mapping must not trust `status`
    // alone from an untyped/legacy caller — it must gate on status === "sent".
    const result = {
      status: "failed",
      error: "boom",
      messageId: "unexpected-id",
    } as EmailResult;

    await recordBetaInvitationDeliveryAttempt({
      ...baseParams,
      trigger: "issue",
      result,
    });

    expect(mockPrisma.betaInvitationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        status: "FAILED",
        providerMessageId: null,
      }),
    });
  });

  it("falls back to a placeholder actor identity when the user can't be resolved", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await recordBetaInvitationDeliveryAttempt({
      ...baseParams,
      trigger: "issue",
      result: { status: "skipped" },
    });

    expect(mockPrisma.betaInvitationDeliveryAttempt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        attemptedByEmail: "Unknown (deleted)",
        attemptedByDisplayName: null,
      }),
    });
  });

  it("logs and swallows an audit-insert failure instead of throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPrisma.betaInvitationDeliveryAttempt.create.mockRejectedValue(
      new Error("db unavailable"),
    );

    await expect(
      recordBetaInvitationDeliveryAttempt({
        ...baseParams,
        trigger: "issue",
        result: { status: "sent", messageId: "msg-1" },
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("logs and swallows an actor-lookup failure instead of throwing", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    mockPrisma.user.findUnique.mockRejectedValue(new Error("db unavailable"));

    await expect(
      recordBetaInvitationDeliveryAttempt({
        ...baseParams,
        trigger: "issue",
        result: { status: "sent", messageId: "msg-1" },
      }),
    ).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    expect(mockPrisma.betaInvitationDeliveryAttempt.create).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
