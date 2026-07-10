import { describe, it, expect, vi, beforeEach } from "vitest";
import { createAlliance } from "./createAlliance";

vi.mock("./prisma", () => ({
  prisma: {
    betaInvitation: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    }
    alliance: {
      create: vi.fn(),
    },
    allianceMembership: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "./prisma";

const mockPrisma = prisma as unknown as {
  betaInvitation: {
    findUnique: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  alliance: {
    create: ReturnType<typeof vi.fn>;
  };
  allianceMembership: {
    create: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createAlliance", () => {
  it("creates alliance with OWNER membership", async () => {
    const betaInvitation = {
      id: "beta-1",
      acceptedByUserId: "user-1",
      allianceId: null,
      alliance: null,
    };

    const newAlliance = {
      id: "alliance-1",
      name: "DAY1",
      server: "default",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    mockPrisma.betaInvitation.findUnique.mockResolvedValue(betaInvitation);
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const tx = {
        alliance: {
          create: vi.fn().mockResolvedValue(newAlliance),
        },
        allianceMembership: {
          create: vi.fn().mockResolvedValue({ id: "membership-1" }),
        },
        betaInvitation: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        }
      };
      return callback(tx);
    });

    const result = await createAlliance({
      name: "DAY1",
      userId: "user-1",
      betaInvitationId: "beta-1",
    });

    expect(result.alliance.name).toBe("DAY1");
    expect(result.alreadyExisted).toBe(false);
  });

  it("trims alliance name", async () => {
    const betaInvitation = {
      id: "beta-1",
      acceptedByUserId: "user-1",
      allianceId: null,
      alliance: null,
    };

    mockPrisma.betaInvitation.findUnique.mockResolvedValue(betaInvitation);
    mockPrisma.$transaction.mockImplementation(async (callback) => {
      const tx = {
        alliance: {
          create: vi.fn().mockImplementation(async ({ data }) => ({
            id: "alliance-1",
            ...data,
            createdAt: new Date(),
            updatedAt: new Date(),
          })),
        },
        allianceMembership: {
          create: vi.fn().mockResolvedValue({ id: "membership-1" }),
        },
        betaInvitation: {
          update: vi.fn().mockResolvedValue({}),
        },
      };
      return callback(tx);
    });

    const result = await createAlliance({
      name: "  DAY1  ",
      userId: "user-1",
      betaInvitationId: "beta-1",
    });

    expect(result.alliance.name).toBe("DAY1");
  });

  it("returns existing alliance if already created (idempotent)", async () => {
    const existingAlliance = {
      id: "alliance-1",
      name: "DAY1",
      server: "default",
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const betaInvitation = {
      id: "beta-1",
      acceptedByUserId: "user-1",
      allianceId: "alliance-1",
      alliance: existingAlliance,
    };

    mockPrisma.betaInvitation.findUnique.mockResolvedValue(betaInvitation);

    const result = await createAlliance({
      name: "New Name",
      userId: "user-1",
      betaInvitationId: "beta-1",
    });

    expect(result.alliance).toEqual(existingAlliance);
    expect(result.alreadyExisted).toBe(true);
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("throws if alliance name is empty", async () => {
    await expect(
      createAlliance({
        name: "   ",
        userId: "user-1",
        betaInvitationId: "beta-1",
      })
    ).rejects.toThrow("Alliance name is required");
  });

  it("throws if beta invitation not found", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);

    await expect(
      createAlliance({
        name: "DAY1",
        userId: "user-1",
        betaInvitationId: "invalid",
      })
    ).rejects.toThrow("Beta invitation not found");
  });

  it("throws if beta invitation belongs to different user", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "beta-1",
      acceptedByUserId: "other-user",
      allianceId: null,
      alliance: null,
    });

    await expect(
      createAlliance({
        name: "DAY1",
        userId: "user-1",
        betaInvitationId: "beta-1",
      })
    ).rejects.toThrow("This beta invitation was not accepted by you");
  });
});
