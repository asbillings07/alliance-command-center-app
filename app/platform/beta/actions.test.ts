import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRequirePlatformAdmin = vi.fn();
const mockIssueBetaInvitation = vi.fn();
const mockReissueBetaInvitation = vi.fn();
const mockDeliverBetaInvitationEmail = vi.fn();
const mockDeliverBetaInvitationEmailWithClaim = vi.fn();
const mockRevalidatePath = vi.fn();

vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({
  requirePlatformAdmin: () => mockRequirePlatformAdmin(),
}));

vi.mock("@/app/src/lib/betaInvitation", () => ({
  issueBetaInvitation: (...args: unknown[]) => mockIssueBetaInvitation(...args),
  reissueBetaInvitation: (...args: unknown[]) => mockReissueBetaInvitation(...args),
  deliverBetaInvitationEmail: (...args: unknown[]) =>
    mockDeliverBetaInvitationEmail(...args),
  deliverBetaInvitationEmailWithClaim: (...args: unknown[]) =>
    mockDeliverBetaInvitationEmailWithClaim(...args),
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
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/app/src/lib/email", () => ({
  emailService: {
    sendBetaInvitation: vi.fn(),
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
import { prisma } from "@/app/src/lib/prisma";

const mockFindUnique = prisma.betaInvitation.findUnique as ReturnType<
  typeof vi.fn
>;

describe("platform beta actions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRequirePlatformAdmin.mockResolvedValue({ id: "operator-1" });
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
    mockDeliverBetaInvitationEmail.mockResolvedValue("sent");

    await createInvitationAction("test@example.com", "notes", "Wave 1");

    expect(mockIssueBetaInvitation).toHaveBeenCalledWith("test@example.com", {
      notes: "notes",
      campaign: "Wave 1",
      issuedByUserId: "operator-1",
    });
    expect(mockDeliverBetaInvitationEmail).toHaveBeenCalled();
    expect(mockDeliverBetaInvitationEmail).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-1" }),
      "https://example.com/redeem/tok",
      expect.any(Function),
      "operator-1",
    );
  });

  it("returns reissue credentials when email delivery fails", async () => {
    mockReissueBetaInvitation.mockResolvedValue({
      invitation: {
        id: "inv-reissue",
        email: "test@example.com",
        expiresAt: new Date("2026-12-31"),
      },
      inviteCode: "NEW-CODE",
      inviteUrl: "https://example.com/redeem/new",
    });
    mockDeliverBetaInvitationEmailWithClaim.mockResolvedValue("failed");

    const result = await reissueInvitationAction("participant-1", "Wave 2");

    expect(result).toEqual({
      success: true,
      inviteCode: "NEW-CODE",
      inviteUrl: "https://example.com/redeem/new",
      email: "test@example.com",
      emailStatus: "failed",
    });
    expect(mockDeliverBetaInvitationEmailWithClaim).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-reissue" }),
      "https://example.com/redeem/new",
      expect.any(Function),
      "operator-1",
      "reissue",
    );
  });

  it("returns reissue credentials when delivery claim contention throws", async () => {
    mockReissueBetaInvitation.mockResolvedValue({
      invitation: {
        id: "inv-reissue",
        email: "test@example.com",
        expiresAt: new Date("2026-12-31"),
      },
      inviteCode: "NEW-CODE",
      inviteUrl: "https://example.com/redeem/new",
    });
    mockDeliverBetaInvitationEmailWithClaim.mockRejectedValue(
      new Error("A delivery attempt is in progress for the latest invitation — try again shortly"),
    );

    const result = await reissueInvitationAction("participant-1");

    expect(result).toEqual({
      success: true,
      inviteCode: "NEW-CODE",
      inviteUrl: "https://example.com/redeem/new",
      email: "test@example.com",
      emailStatus: "failed",
    });
    expect(mockReissueBetaInvitation).toHaveBeenCalled();
  });

  it("resend uses claim-protected abortable delivery", async () => {
    mockFindUnique.mockResolvedValue({
      id: "inv-1",
      email: "test@example.com",
      token: "tok",
      code: "ABC-DEF",
      expiresAt: new Date(Date.now() + 86400000),
      acceptedAt: null,
      revokedAt: null,
    });
    mockDeliverBetaInvitationEmailWithClaim.mockResolvedValue("sent");

    const result = await resendInvitationEmailAction("inv-1");

    expect(result).toEqual({ success: true, emailStatus: "sent" });
    expect(mockDeliverBetaInvitationEmailWithClaim).toHaveBeenCalledWith(
      expect.objectContaining({ id: "inv-1" }),
      expect.any(String),
      expect.any(Function),
      "operator-1",
      "resend",
    );
  });
});
