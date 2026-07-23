import { describe, it, expect, beforeEach, vi } from "vitest";
import { prisma } from "./prisma";
import {
  inviteLeadershipCollaborator,
  findPendingInvitation,
  searchMembers,
  cancelInvitation,
  resendInvitation,
} from "./inviteLeadershipCollaborator";

// Mock Prisma
vi.mock("./prisma", () => {
  const mockMember = {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    count: vi.fn().mockResolvedValue(0),
  };
  const mockTx = {
    allianceMember: mockMember,
    $executeRaw: vi.fn().mockResolvedValue(1),
  };
  return {
    prisma: {
      invitation: {
        findFirst: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      allianceMembership: {
        findFirst: vi.fn(),
      },
      allianceMember: mockMember,
      $executeRaw: vi.fn().mockResolvedValue(1),
      $transaction: vi.fn((cb) => cb(mockTx)),
    },
  };
});

describe("inviteLeadershipCollaborator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("findPendingInvitation", () => {
    it("returns null when no pending invitation exists", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);

      const result = await findPendingInvitation("alliance-1", "test@example.com");

      expect(result).toBeNull();
      expect(prisma.invitation.findFirst).toHaveBeenCalledWith({
        where: {
          allianceId: "alliance-1",
          email: { equals: "test@example.com", mode: "insensitive" },
          acceptedAt: null,
          cancelledAt: null,
          expiresAt: { gt: expect.any(Date) },
        },
      });
    });

    it("returns invitation when pending invitation exists", async () => {
      const mockInvitation = {
        id: "inv-1",
        email: "test@example.com",
        allianceId: "alliance-1",
      };
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(mockInvitation as never);

      const result = await findPendingInvitation("alliance-1", "test@example.com");

      expect(result).toEqual(mockInvitation);
    });
  });

  describe("searchMembers", () => {
    it("returns members without userId (unlinked members only)", async () => {
      const mockMembers = [
        { id: "m1", playerName: "Dragon" },
        { id: "m2", playerName: "Val" },
      ];
      vi.mocked(prisma.allianceMember.findMany).mockResolvedValue(mockMembers as never);

      const result = await searchMembers("alliance-1", "");

      expect(result).toEqual(mockMembers);
      expect(prisma.allianceMember.findMany).toHaveBeenCalledWith({
        where: {
          allianceId: "alliance-1",
          archivedAt: null,
          userId: null,
        },
        select: { id: true, playerName: true },
        orderBy: { playerName: "asc" },
        take: 20,
      });
    });

    it("filters by query when provided", async () => {
      vi.mocked(prisma.allianceMember.findMany).mockResolvedValue([]);

      await searchMembers("alliance-1", "Dra");

      expect(prisma.allianceMember.findMany).toHaveBeenCalledWith({
        where: {
          allianceId: "alliance-1",
          archivedAt: null,
          userId: null,
          playerName: { contains: "Dra", mode: "insensitive" },
        },
        select: { id: true, playerName: true },
        orderBy: { playerName: "asc" },
        take: 20,
      });
    });
  });

  describe("inviteLeadershipCollaborator", () => {
    const baseInput = {
      allianceId: "alliance-1",
      invitedById: "user-1",
      playerName: "Dragon",
      email: "dragon@example.com",
      membershipRole: "LEADER" as const,
    };

    it("throws error when pending invitation already exists", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue({
        id: "existing-inv",
      } as never);

      await expect(inviteLeadershipCollaborator(baseInput)).rejects.toThrow(
        "A pending invitation already exists for this email"
      );
    });

    it("throws error when email already has alliance membership", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMembership.findFirst).mockResolvedValue({
        id: "membership-1",
      } as never);

      await expect(inviteLeadershipCollaborator(baseInput)).rejects.toThrow(
        "This email already has access to this alliance"
      );
    });

    it("throws error when selected member not found", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMembership.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMember.findUnique).mockResolvedValue(null);

      await expect(
        inviteLeadershipCollaborator({
          ...baseInput,
          existingMemberId: "nonexistent-member",
        })
      ).rejects.toThrow("Selected member not found");
    });

    it("throws error when selected member belongs to different alliance", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMembership.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMember.findUnique).mockResolvedValue({
        id: "member-1",
        allianceId: "different-alliance",
        userId: null,
      } as never);

      await expect(
        inviteLeadershipCollaborator({
          ...baseInput,
          existingMemberId: "member-1",
        })
      ).rejects.toThrow("Selected member does not belong to this alliance");
    });

    it("throws error when selected member is already connected to a user", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMembership.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMember.findUnique).mockResolvedValue({
        id: "member-1",
        allianceId: "alliance-1",
        userId: "some-user-id",
        playerName: "Dragon",
      } as never);

      await expect(
        inviteLeadershipCollaborator({
          ...baseInput,
          existingMemberId: "member-1",
        })
      ).rejects.toThrow("This member is already connected to a user account");
    });

    it("creates new member when existingMemberId not provided", async () => {
      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMembership.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMember.create).mockResolvedValue({
        id: "new-member-1",
        allianceId: "alliance-1",
        playerName: "Dragon",
      } as never);
      vi.mocked(prisma.invitation.create).mockResolvedValue({
        id: "inv-1",
        token: "test-token",
        code: "ABC-123-XYZ",
      } as never);

      const result = await inviteLeadershipCollaborator(baseInput);

      expect(result.memberCreated).toBe(true);
      expect(prisma.allianceMember.create).toHaveBeenCalledWith({
        data: {
          allianceId: "alliance-1",
          playerName: "Dragon",
          thp: undefined,
          squadPower: undefined,
        },
      });
    });

    it("uses existing member when existingMemberId provided", async () => {
      const existingMember = {
        id: "existing-member-1",
        allianceId: "alliance-1",
        playerName: "Dragon",
        userId: null,
      };

      vi.mocked(prisma.invitation.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMembership.findFirst).mockResolvedValue(null);
      vi.mocked(prisma.allianceMember.findUnique).mockResolvedValue(existingMember as never);
      vi.mocked(prisma.invitation.create).mockResolvedValue({
        id: "inv-1",
        token: "test-token",
        code: "ABC-123-XYZ",
      } as never);

      const result = await inviteLeadershipCollaborator({
        ...baseInput,
        existingMemberId: "existing-member-1",
      });

      expect(result.memberCreated).toBe(false);
      expect(prisma.allianceMember.create).not.toHaveBeenCalled();
    });
  });

  describe("cancelInvitation", () => {
    it("throws error when invitation not found", async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(null);

      await expect(cancelInvitation("nonexistent-id")).rejects.toThrow(
        "Invitation not found"
      );
      expect(prisma.invitation.update).not.toHaveBeenCalled();
    });

    it("throws error when invitation already accepted", async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue({
        acceptedAt: new Date(),
        cancelledAt: null,
      } as never);

      await expect(cancelInvitation("inv-1")).rejects.toThrow(
        "Cannot cancel an invitation that has already been accepted"
      );
      expect(prisma.invitation.update).not.toHaveBeenCalled();
    });

    it("throws error when invitation already cancelled", async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue({
        acceptedAt: null,
        cancelledAt: new Date(),
      } as never);

      await expect(cancelInvitation("inv-1")).rejects.toThrow(
        "This invitation has already been cancelled"
      );
      expect(prisma.invitation.update).not.toHaveBeenCalled();
    });

    it("successfully cancels a pending invitation", async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue({
        acceptedAt: null,
        cancelledAt: null,
      } as never);
      vi.mocked(prisma.invitation.update).mockResolvedValue({
        id: "inv-1",
        cancelledAt: new Date(),
      } as never);

      const result = await cancelInvitation("inv-1");

      expect(result.cancelledAt).toBeDefined();
      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: "inv-1" },
        data: { cancelledAt: expect.any(Date) },
      });
    });
  });

  describe("resendInvitation", () => {
    it("throws error when invitation not found", async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue(null);

      await expect(resendInvitation("nonexistent-id")).rejects.toThrow(
        "Invitation not found"
      );
      expect(prisma.invitation.update).not.toHaveBeenCalled();
    });

    it("throws error when invitation already accepted", async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue({
        acceptedAt: new Date(),
      } as never);

      await expect(resendInvitation("inv-1")).rejects.toThrow(
        "Cannot resend an invitation that has already been accepted"
      );
      expect(prisma.invitation.update).not.toHaveBeenCalled();
    });

    it("successfully resends a pending invitation with new token and code", async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue({
        acceptedAt: null,
      } as never);
      vi.mocked(prisma.invitation.update).mockResolvedValue({
        id: "inv-1",
        token: "new-token",
        code: "NEW-123-XYZ",
        expiresAt: new Date(),
      } as never);

      const result = await resendInvitation("inv-1");

      expect(result.inviteUrl).toContain("/invite/");
      expect(result.inviteCode).toBeDefined();
      expect(prisma.invitation.update).toHaveBeenCalledWith({
        where: { id: "inv-1" },
        data: {
          token: expect.any(String),
          code: expect.any(String),
          expiresAt: expect.any(Date),
          cancelledAt: null,
        },
      });
    });

    it("resends a cancelled invitation (clears cancelledAt)", async () => {
      vi.mocked(prisma.invitation.findUnique).mockResolvedValue({
        acceptedAt: null,
      } as never);
      vi.mocked(prisma.invitation.update).mockResolvedValue({
        id: "inv-1",
        token: "new-token",
        code: "NEW-456-ABC",
        expiresAt: new Date(),
        cancelledAt: null,
      } as never);

      await resendInvitation("inv-1");

      expect(prisma.invitation.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cancelledAt: null,
          }),
        })
      );
    });
  });
});
