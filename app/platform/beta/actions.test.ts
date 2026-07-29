import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EmailResult } from "@/app/src/lib/email";

const mockRequirePlatformAdmin = vi.fn();
const mockIssueBetaInvitation = vi.fn();
const mockReissueBetaInvitation = vi.fn();
const mockClaimBetaInvitationResend = vi.fn();
const mockReleaseBetaInvitationResend = vi.fn();
const mockAwaitEmailDeliverySettlement = vi.fn();
const mockWithEmailProviderTimeout = vi.fn();
const mockRevalidatePath = vi.fn();
const mockSendBetaInvitation = vi.fn();
const mockFindUnique = vi.fn();

vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: () => mockRequirePlatformAdmin(),
}));

vi.mock("@/app/src/lib/betaInvitation", () => ({
  issueBetaInvitation: (...args: unknown[]) => mockIssueBetaInvitation(...args),
  reissueBetaInvitation: (...args: unknown[]) => mockReissueBetaInvitation(...args),
  claimBetaInvitationResend: (...args: unknown[]) =>
    mockClaimBetaInvitationResend(...args),
  releaseBetaInvitationResend: (...args: unknown[]) =>
    mockReleaseBetaInvitationResend(...args),
  awaitEmailDeliverySettlement: (...args: unknown[]) =>
    mockAwaitEmailDeliverySettlement(...args),
  withEmailProviderTimeout: (...args: unknown[]) =>
    mockWithEmailProviderTimeout(...args),
  isPendingInvitation: (invitation: {
    acceptedAt: Date | null;
    revokedAt: Date | null;
    expiresAt: Date;
  }) =>
    !invitation.acceptedAt &&
    !invitation.revokedAt &&
    invitation.expiresAt >= new Date(),
  revokeBetaInvitation: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => mockRevalidatePath(...args),
}));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    betaInvitation: {
      findUnique: (...args: unknown[]) => mockFindUnique(...args),
    },
  },
}));

vi.mock("@/app/src/lib/email", () => ({
  emailService: {
    sendBetaInvitation: (...args: unknown[]) => mockSendBetaInvitation(...args),
  },
}));

vi.mock("@/app/src/lib/appUrl", () => ({
  getRedeemUrl: (token: string) => `https://example.com/redeem/${token}`,
}));

import {
  createInvitationAction,
  reissueInvitationAction,
  resendInvitationEmailAction,
} from "./actions";

describe("platform beta actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePlatformAdmin.mockResolvedValue({ id: "operator-1" });
    mockAwaitEmailDeliverySettlement.mockImplementation(async (promise) => promise);
    mockReleaseBetaInvitationResend.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes issuedByUserId through createInvitationAction", async () => {
    mockIssueBetaInvitation.mockResolvedValue({
      invitation: {
        id: "inv-1",
        email: "test@example.com",
        expiresAt: new Date("2026-12-31"),
      },
      inviteCode: "ABC-DEF",
      inviteUrl: "https://example.com/redeem/tok",
    });
    mockSendBetaInvitation.mockResolvedValue({ status: "sent" });

    await createInvitationAction("test@example.com", "notes", "Wave 1");

    expect(mockIssueBetaInvitation).toHaveBeenCalledWith("test@example.com", {
      notes: "notes",
      campaign: "Wave 1",
      issuedByUserId: "operator-1",
    });
  });

  it("returns reissue credentials when email delivery times out", async () => {
    mockReissueBetaInvitation.mockResolvedValue({
      invitation: {
        id: "inv-reissue",
        email: "test@example.com",
        expiresAt: new Date("2026-12-31"),
      },
      inviteCode: "NEW-CODE",
      inviteUrl: "https://example.com/redeem/new",
    });
    mockWithEmailProviderTimeout.mockRejectedValue(
      new Error("Email delivery timed out"),
    );

    const result = await reissueInvitationAction("participant-1", "Wave 2");

    expect(result).toEqual({
      success: true,
      inviteCode: "NEW-CODE",
      inviteUrl: "https://example.com/redeem/new",
      email: "test@example.com",
      emailStatus: "failed",
    });
  });

  it("retains resend claim until email delivery settles after timeout", async () => {
    mockClaimBetaInvitationResend.mockResolvedValue({
      invitationId: "inv-1",
      claimId: "claim-1",
    });
    mockFindUnique.mockResolvedValue({
      id: "inv-1",
      email: "test@example.com",
      token: "tok",
      code: "ABC-DEF",
      expiresAt: new Date(Date.now() + 86400000),
      acceptedAt: null,
      revokedAt: null,
    });

    let resolveSend!: (value: EmailResult) => void;
    const underlyingSend = new Promise<EmailResult>((resolve) => {
      resolveSend = resolve;
    });
    mockSendBetaInvitation.mockReturnValue(underlyingSend);
    mockWithEmailProviderTimeout.mockRejectedValue(
      new Error("Email delivery timed out"),
    );

    const releaseOrder: string[] = [];
    mockAwaitEmailDeliverySettlement.mockImplementation(async (promise) => {
      releaseOrder.push("settlement-start");
      const result = await promise;
      releaseOrder.push("settlement-end");
      return result;
    });
    mockReleaseBetaInvitationResend.mockImplementation(async () => {
      releaseOrder.push("release");
    });

    const actionPromise = resendInvitationEmailAction("inv-1");

    await Promise.resolve();
    expect(mockReleaseBetaInvitationResend).not.toHaveBeenCalled();

    resolveSend({ status: "sent" });
    const result = await actionPromise;

    expect(result).toEqual({ success: false, error: "Email delivery timed out" });
    expect(mockAwaitEmailDeliverySettlement).toHaveBeenCalledWith(underlyingSend);
    expect(releaseOrder).toEqual(["settlement-start", "settlement-end", "release"]);
  });
});
