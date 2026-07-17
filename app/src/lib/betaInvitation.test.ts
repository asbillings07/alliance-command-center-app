import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  issueBetaInvitation,
  getPendingInvitation,
  isPendingInvitation,
  validateBetaToken,
  validateBetaCode,
  acceptBetaInvitation,
  revokeBetaInvitation,
  getPendingAllianceCreation,
} from "./betaInvitation";
import type { BetaInvitation } from "@/app/generated/prisma/client";

vi.mock("./prisma", () => ({
  prisma: {
    betaInvitation: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
    allianceMembership: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "./prisma";

const mockPrisma = prisma as unknown as {
  betaInvitation: {
    findUnique: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    updateMany: ReturnType<typeof vi.fn>;
  };
  user: {
    findUnique: ReturnType<typeof vi.fn>;
  };
  allianceMembership: {
    findFirst: ReturnType<typeof vi.fn>;
  };
  $transaction: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  vi.clearAllMocks();
  // Run transaction callbacks against the same mocked client (tx === prisma).
  mockPrisma.$transaction.mockImplementation(
    async (fn: (tx: typeof prisma) => unknown) => fn(prisma)
  );
});

function makeInvitation(
  overrides: Partial<BetaInvitation> = {}
): BetaInvitation {
  const now = new Date();
  return {
    id: "inv-1",
    email: "test@example.com",
    token: "token",
    code: "ABC-123",
    notes: null,
    campaign: null,
    expiresAt: new Date(now.getTime() + 86400000),
    createdAt: now,
    issuedAt: now,
    acceptedAt: null,
    acceptedByUserId: null,
    revokedAt: null,
    allianceId: null,
    ...overrides,
  };
}

describe("isPendingInvitation", () => {
  it("returns true for a not-accepted, not-revoked, unexpired invitation", () => {
    expect(isPendingInvitation(makeInvitation())).toBe(true);
  });

  it("returns false when accepted", () => {
    expect(
      isPendingInvitation(makeInvitation({ acceptedAt: new Date() }))
    ).toBe(false);
  });

  it("returns false when revoked", () => {
    expect(
      isPendingInvitation(makeInvitation({ revokedAt: new Date() }))
    ).toBe(false);
  });

  it("returns false when expired", () => {
    expect(
      isPendingInvitation(
        makeInvitation({ expiresAt: new Date(Date.now() - 86400000) })
      )
    ).toBe(false);
  });
});

describe("getPendingInvitation", () => {
  it("queries directly for a pending invitation and normalizes email", async () => {
    const invitation = makeInvitation();
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(invitation);

    const result = await getPendingInvitation("TEST@EXAMPLE.COM");

    expect(result).toEqual(invitation);
    expect(mockPrisma.betaInvitation.findFirst).toHaveBeenCalledWith({
      where: {
        email: "test@example.com",
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gte: expect.any(Date) },
      },
      orderBy: { issuedAt: "desc" },
    });
  });

  it("returns null when no pending invitation exists", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(null);

    const result = await getPendingInvitation("test@example.com");

    expect(result).toBeNull();
  });
});

describe("issueBetaInvitation", () => {
  it("creates a new invitation with token and code", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.betaInvitation.create.mockImplementation(async ({ data }) => ({
      id: "inv-1",
      ...data,
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      allianceId: null,
    }));

    const result = await issueBetaInvitation("test@example.com");

    expect(result.invitation.email).toBe("test@example.com");
    expect(result.invitation.token).toBeDefined();
    expect(result.invitation.code).toMatch(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/);
    expect(result.inviteUrl).toContain("/redeem/");
    expect(result.inviteCode).toBe(result.invitation.code);
  });

  it("normalizes email to lowercase", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.betaInvitation.create.mockImplementation(async ({ data }) => ({
      id: "inv-1",
      ...data,
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      allianceId: null,
    }));

    const result = await issueBetaInvitation("TEST@EXAMPLE.COM");

    expect(result.invitation.email).toBe("test@example.com");
  });

  it("persists notes and campaign when provided", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.betaInvitation.create.mockImplementation(async ({ data }) => ({
      id: "inv-1",
      ...data,
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      allianceId: null,
    }));

    const result = await issueBetaInvitation("test@example.com", {
      notes: " Met at conference ",
      campaign: " Wave 1 ",
    });

    expect(result.invitation.notes).toBe("Met at conference");
    expect(result.invitation.campaign).toBe("Wave 1");
  });

  it("always creates a new record (never mutates history)", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.betaInvitation.create.mockImplementation(async ({ data }) => ({
      id: "inv-2",
      ...data,
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      allianceId: null,
    }));

    await issueBetaInvitation("test@example.com");

    expect(mockPrisma.betaInvitation.create).toHaveBeenCalledTimes(1);
    expect(mockPrisma.betaInvitation.update).not.toHaveBeenCalled();
  });

  it("throws if a pending invitation already exists for email", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(makeInvitation());

    await expect(issueBetaInvitation("test@example.com")).rejects.toThrow(
      "A pending beta invitation already exists for this email"
    );
    expect(mockPrisma.betaInvitation.create).not.toHaveBeenCalled();
  });

  it("throws if user already has an alliance", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue({ id: "user-1" });
    mockPrisma.allianceMembership.findFirst.mockResolvedValue({
      id: "membership-1",
    });

    await expect(issueBetaInvitation("test@example.com")).rejects.toThrow(
      "This user already has access to an alliance"
    );
    expect(mockPrisma.betaInvitation.create).not.toHaveBeenCalled();
  });

  it("enforces the pending check and create in a serializable transaction", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue(null);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.betaInvitation.create.mockImplementation(async ({ data }) => ({
      id: "inv-1",
      ...data,
      acceptedAt: null,
      acceptedByUserId: null,
      revokedAt: null,
      allianceId: null,
    }));

    await issueBetaInvitation("test@example.com");

    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mockPrisma.$transaction).toHaveBeenCalledWith(expect.any(Function), {
      isolationLevel: "Serializable",
    });
  });
});

describe("validateBetaToken", () => {
  it("returns valid status for valid token", async () => {
    const invitation = {
      id: "inv-1",
      token: "valid-token",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
    };
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(invitation);

    const result = await validateBetaToken("valid-token");

    expect(result.status).toBe("valid");
    expect(result.invitation).toEqual(invitation);
  });

  it("returns not_found status for unknown token", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);

    const result = await validateBetaToken("unknown-token");

    expect(result.status).toBe("not_found");
    expect(result.invitation).toBeNull();
  });

  it("returns expired status for expired invitation", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      token: "expired-token",
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 86400000),
    });

    const result = await validateBetaToken("expired-token");

    expect(result.status).toBe("expired");
    expect(result.invitation).toBeNull();
  });

  it("returns already_accepted status for accepted invitation", async () => {
    const invitation = {
      id: "inv-1",
      token: "accepted-token",
      acceptedAt: new Date(),
      acceptedByUserId: "user-1",
      expiresAt: new Date(Date.now() + 86400000),
    };
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(invitation);

    const result = await validateBetaToken("accepted-token");

    expect(result.status).toBe("already_accepted");
    expect(result.invitation).toEqual(invitation);
  });
});

describe("validateBetaCode", () => {
  it("returns valid status for valid code", async () => {
    const invitation = {
      id: "inv-1",
      code: "ABC-123",
      acceptedAt: null,
      expiresAt: new Date(Date.now() + 86400000),
    };
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(invitation);

    const result = await validateBetaCode("abc-123");

    expect(result.status).toBe("valid");
    expect(result.invitation).toEqual(invitation);
    expect(mockPrisma.betaInvitation.findUnique).toHaveBeenCalledWith({
      where: { code: "ABC-123" },
    });
  });

  it("returns not_found status for unknown code", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);

    const result = await validateBetaCode("XYZ-999");

    expect(result.status).toBe("not_found");
    expect(result.invitation).toBeNull();
  });

  it("returns expired status for expired invitation", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      code: "ABC-123",
      acceptedAt: null,
      expiresAt: new Date(Date.now() - 86400000),
    });

    const result = await validateBetaCode("ABC-123");

    expect(result.status).toBe("expired");
    expect(result.invitation).toBeNull();
  });

  it("returns already_accepted status for accepted invitation", async () => {
    const invitation = {
      id: "inv-1",
      code: "ABC-123",
      acceptedAt: new Date(),
      acceptedByUserId: "user-1",
      expiresAt: new Date(Date.now() + 86400000),
    };
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(invitation);

    const result = await validateBetaCode("ABC-123");

    expect(result.status).toBe("already_accepted");
    expect(result.invitation).toEqual(invitation);
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
    const acceptedInvitation = {
      id: "inv-1",
      acceptedAt: new Date(),
      acceptedByUserId: "user-1",
      expiresAt: invitation.expiresAt,
    };
    mockPrisma.betaInvitation.findUnique
      .mockResolvedValueOnce(invitation)
      .mockResolvedValueOnce(acceptedInvitation);
    mockPrisma.betaInvitation.updateMany.mockResolvedValue({ count: 1 });

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

describe("revokeBetaInvitation", () => {
  it("successfully revokes a pending invitation (atomic)", async () => {
    mockPrisma.betaInvitation.updateMany.mockResolvedValue({ count: 1 });

    await revokeBetaInvitation("inv-1");

    expect(mockPrisma.betaInvitation.updateMany).toHaveBeenCalledWith({
      where: {
        id: "inv-1",
        acceptedAt: null,
        revokedAt: null,
      },
      data: { revokedAt: expect.any(Date) },
    });
  });

  it("throws if invitation not found", async () => {
    mockPrisma.betaInvitation.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.betaInvitation.findUnique.mockResolvedValue(null);

    await expect(revokeBetaInvitation("inv-1")).rejects.toThrow(
      "Beta invitation not found"
    );
  });

  it("throws if invitation already accepted", async () => {
    mockPrisma.betaInvitation.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      acceptedAt: new Date(),
      revokedAt: null,
    });

    await expect(revokeBetaInvitation("inv-1")).rejects.toThrow(
      "Cannot revoke an accepted invitation"
    );
  });

  it("throws if invitation already revoked", async () => {
    mockPrisma.betaInvitation.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      acceptedAt: null,
      revokedAt: new Date(),
    });

    await expect(revokeBetaInvitation("inv-1")).rejects.toThrow(
      "Invitation has already been revoked"
    );
  });
});

describe("validateBetaToken - revoked status", () => {
  it("returns revoked status for revoked invitation", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      token: "test-token",
      acceptedAt: null,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const result = await validateBetaToken("test-token");

    expect(result.status).toBe("revoked");
    expect(result.invitation).toBeNull();
  });
});

describe("validateBetaCode - revoked status", () => {
  it("returns revoked status for revoked invitation", async () => {
    mockPrisma.betaInvitation.findFirst.mockResolvedValue({
      id: "inv-1",
      code: "TEST-CODE",
      acceptedAt: null,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    const result = await validateBetaCode("TEST-CODE");

    expect(result.status).toBe("revoked");
    expect(result.invitation).toBeNull();
  });
});

describe("acceptBetaInvitation - revoked handling", () => {
  it("throws if invitation is revoked", async () => {
    mockPrisma.betaInvitation.findUnique.mockResolvedValue({
      id: "inv-1",
      acceptedAt: null,
      revokedAt: new Date(),
      expiresAt: new Date(Date.now() + 86400000),
    });

    await expect(acceptBetaInvitation("inv-1", "user-1")).rejects.toThrow(
      "This beta invitation has been revoked"
    );
  });

  it("throws revoked error if race condition revokes during accept", async () => {
    mockPrisma.betaInvitation.findUnique
      .mockResolvedValueOnce({
        id: "inv-1",
        acceptedAt: null,
        revokedAt: null,
        expiresAt: new Date(Date.now() + 86400000),
      })
      .mockResolvedValueOnce({
        id: "inv-1",
        acceptedAt: null,
        revokedAt: new Date(),
        acceptedByUserId: null,
      });
    mockPrisma.betaInvitation.updateMany.mockResolvedValue({ count: 0 });

    await expect(acceptBetaInvitation("inv-1", "user-1")).rejects.toThrow(
      "This beta invitation has been revoked"
    );
  });
});
