import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createBetaInvitation,
  validateBetaToken,
  validateBetaCode,
  acceptBetaInvitation,
  getPendingAllianceCreation,
} from "./betaInvitation";

vi.mock("./prisma", () => ({
  prisma: {
    betaInvitation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    allianceMembership: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "./prisma";

const mockPrisma = prisma as unknown as {
  betaInvitation: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  allianceMembership: {
    findFirst: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createBetaInvitation", () => {
  it("creates an invitation with token and code", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.betaInvitation.create.mockImplementation(async ({ data }) => ({
      id: "inv-1",
      ...data,
      createdAt: new Date(),
      acceptedAt: null,
      acceptedByUserId: null,
      allianceId: null,
    }));

    const result = await createBetaInvitation("test@example.com");

    expect(result.invitation.email).toBe("test@example.com");
    expect(result.invitation.token).toBeDefined();
    expect(result.invitation.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect(result.inviteUrl).toContain("/redeem/");
    expect(result.inviteCode).toBe(result.invitation.code);
  });

  it("normalizes email to lowercase", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.betaInvitation.create.mockImplementation(async ({ data }) => ({
      id: "inv-1",
      ...data,
      createdAt: new Date(),
      acceptedAt: null,
      acceptedByUserId: null,
      allianceId: null,
    }));

    const result = await createBetaInvitation("TEST@EXAMPLE.COM");

    expect(result.invitation.email).toBe("test@example.com");
  });

  it("throws if invitation already exists for email", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "existing",
      email: "test@example.com",
    });

    await expect(createBetaInvitation("test@example.com")).rejects.toThrow(
      "A beta invitation already exists for this email"
    );
  });

  it("throws if user already has an alliance", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    mockPrisma.allianceMembership.findFirst.mockResolvedValue({
      id: "membership-1",
    });

    await expect(createBetaInvitation("test@example.com")).rejects.toThrow(
      "This user already has access to an alliance"
    );
  });
});

describe("validateBetaToken", () => {
  it("returns invitation for valid token", async () => {
    const invitation = {
      id: "inv-1",
      token: "valid-token",
      expiresAt: new Date(Date.now() + 86400000),
    };
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(invitation);

    const result = await validateBetaToken("valid-token");

    expect(result).toEqual(invitation);
  });

  it("returns null for unknown token", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);

    const result = await validateBetaToken("unknown-token");

    expect(result).toBeNull();
  });

  it("returns null for expired invitation", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      token: "expired-token",
      expiresAt: new Date(Date.now() - 86400000),
    });

    const result = await validateBetaToken("expired-token");

    expect(result).toBeNull();
  });
});

describe("validateBetaCode", () => {
  it("returns invitation for valid code", async () => {
    const invitation = {
      id: "inv-1",
      code: "ABC-123",
      expiresAt: new Date(Date.now() + 86400000),
    };
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(invitation);

    const result = await validateBetaCode("abc-123");

    expect(result).toEqual(invitation);
    expect(mockPrisma.betaInvitation.findUnique).toHaveBeenCalledWith({
      where: { code: "ABC-123" },
    });
  });

  it("returns null for unknown code", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);

    const result = await validateBetaCode("XYZ-999");

    expect(result).toBeNull();
  });

  it("returns null for expired invitation", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      code: "ABC-123",
      expiresAt: new Date(Date.now() - 86400000),
    });

    const result = await validateBetaCode("ABC-123");

    expect(result).toBeNull();
  });
});

describe("acceptBetaInvitation", () => {
  it("accepts a pending invitation", async () => {
    const invitation = {
      id: "inv-1",
      acceptedAt: null,
      acceptedByUserId: null,
      expiresAt: new Date(Date.now() + 86400000),
    };
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(invitation);
    mockPrisma.betaInvitation.update.mockImplementation(async ({ data }) => ({
      ...invitation,
      ...data,
    }));

    const result = await acceptBetaInvitation("inv-1", "user-1");

    expect(result.acceptedByUserId).toBe("user-1");
    expect(result.acceptedAt).toBeDefined();
  });

  it("returns existing invitation if already accepted by same user (idempotent)", async () => {
    const invitation = {
      id: "inv-1",
      acceptedAt: new Date(),
      acceptedByUserId: "user-1",
      expiresAt: new Date(Date.now() + 86400000),
    };
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(invitation);

    const result = await acceptBetaInvitation("inv-1", "user-1");

    expect(result).toEqual(invitation);
    expect(mockPrisma.betaInvitation.update).not.toHaveBeenCalled();
  });

  it("throws if already accepted by different user", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      acceptedAt: new Date(),
      acceptedByUserId: "other-user",
      expiresAt: new Date(Date.now() + 86400000),
    });

    await expect(acceptBetaInvitation("inv-1", "user-1")).rejects.toThrow(
      "This beta invitation has already been accepted"
    );
  });

  it("throws if invitation not found", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);

    await expect(acceptBetaInvitation("inv-1", "user-1")).rejects.toThrow(
      "Beta invitation not found"
    );
  });

  it("throws if invitation expired", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      acceptedAt: null,
      acceptedByUserId: null,
      expiresAt: new Date(Date.now() - 86400000),
    });

    await expect(acceptBetaInvitation("inv-1", "user-1")).rejects.toThrow(
      "This beta invitation has expired"
    );
  });
});

describe("getPendingAllianceCreation", () => {
  it("returns accepted invitation without alliance", async () => {
    const invitation = {
      id: "inv-1",
      acceptedAt: new Date(),
      acceptedByUserId: "user-1",
      allianceId: null,
    };
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(invitation);

    const result = await getPendingAllianceCreation("user-1");

    expect(result).toEqual(invitation);
    expect(mockPrisma.betaInvitation.findFirst).toHaveBeenCalledWith({
      where: {
        acceptedByUserId: "user-1",
        allianceId: null,
      },
    });
  });

  it("returns null if no pending creation", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(null);

    const result = await getPendingAllianceCreation("user-1");

    expect(result).toBeNull();
  });

  it("returns null if user has already created alliance", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(null);

    const result = await getPendingAllianceCreation("user-1");

    expect(result).toBeNull();
  });
});
