import { describe, it, expect, vi, beforeEach } from "vitest";
import { isInvitationEligible } from "./eligibility";

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    invitation: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/app/src/lib/betaInvitation", () => ({
  getPendingInvitation: vi.fn(),
}));

import { prisma } from "@/app/src/lib/prisma";
import { getPendingInvitation } from "@/app/src/lib/betaInvitation";

const mockPrisma = prisma as unknown as {
  invitation: { findFirst: ReturnType<typeof vi.fn> };
};
const mockGetPendingInvitation = getPendingInvitation as unknown as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isInvitationEligible", () => {
  it("is true when a pending beta invitation exists", async () => {
    mockGetPendingInvitation.mockResolvedValue({ id: "beta-1" });

    const result = await isInvitationEligible("user@example.com");

    expect(result).toBe(true);
    expect(mockPrisma.invitation.findFirst).not.toHaveBeenCalled();
  });

  it("is true when a pending alliance invitation exists", async () => {
    mockGetPendingInvitation.mockResolvedValue(null);
    mockPrisma.invitation.findFirst.mockResolvedValue({ id: "inv-1" });

    const result = await isInvitationEligible("user@example.com");

    expect(result).toBe(true);
  });

  it("is false when no pending invitation exists", async () => {
    mockGetPendingInvitation.mockResolvedValue(null);
    mockPrisma.invitation.findFirst.mockResolvedValue(null);

    const result = await isInvitationEligible("user@example.com");

    expect(result).toBe(false);
  });

  it("normalizes the email before lookup", async () => {
    mockGetPendingInvitation.mockResolvedValue(null);
    mockPrisma.invitation.findFirst.mockResolvedValue(null);

    await isInvitationEligible("  User@Example.COM ");

    expect(mockGetPendingInvitation).toHaveBeenCalledWith("user@example.com");
    expect(mockPrisma.invitation.findFirst).toHaveBeenCalledWith({
      where: {
        email: "user@example.com",
        acceptedAt: null,
        cancelledAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
    });
  });
});
