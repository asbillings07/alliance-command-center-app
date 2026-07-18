import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import bcrypt from "bcrypt";
import {
  createPasswordResetToken,
  resetPassword,
  isValidPasswordResetToken,
} from "./passwordReset";

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    passwordResetToken: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "@/app/src/lib/prisma";

const mockPrisma = prisma as unknown as {
  passwordResetToken: {
    updateMany: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  user: { update: ReturnType<typeof vi.fn> };
  $transaction: ReturnType<typeof vi.fn>;
};

const VALID_PASSWORD = "Password123!";

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
  // Support both call styles: array (createPasswordResetToken) and interactive
  // callback (resetPassword). tx delegates to the same mocked client.
  mockPrisma.$transaction.mockImplementation(async (arg: unknown) =>
    typeof arg === "function"
      ? (arg as (tx: typeof mockPrisma) => unknown)(mockPrisma)
      : Promise.all(arg as Promise<unknown>[])
  );
});

describe("createPasswordResetToken", () => {
  it("returns a raw token + expiry and persists only the hash", async () => {
    const before = Date.now();
    const { rawToken, expiresAt } = await createPasswordResetToken("user-1");

    // 32 random bytes hex-encoded.
    expect(rawToken).toMatch(/^[0-9a-f]{64}$/);
    // ~1 hour in the future.
    expect(expiresAt.getTime()).toBeGreaterThan(before + 59 * 60 * 1000);

    // Prior outstanding tokens are invalidated first.
    expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-1", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });

    // Only the hash is stored, never the raw token.
    const createArg = mockPrisma.passwordResetToken.create.mock.calls[0][0];
    expect(createArg.data.userId).toBe("user-1");
    expect(createArg.data.tokenHash).toBe(sha256(rawToken));
    expect(createArg.data.tokenHash).not.toBe(rawToken);
  });
});

describe("resetPassword", () => {
  it("rejects a password that fails the policy before touching the token", async () => {
    const result = await resetPassword("rawtoken", "weak");

    expect(result.status).toBe("invalid_password");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("sets the new password and invalidates tokens for a valid token", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "user-9",
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await resetPassword("rawtoken", VALID_PASSWORD);

    expect(result.status).toBe("success");

    const updateArg = mockPrisma.user.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "user-9" });
    expect(
      await bcrypt.compare(VALID_PASSWORD, updateArg.data.passwordHash)
    ).toBe(true);

    // The consumed + any sibling tokens are marked used.
    expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { userId: "user-9", usedAt: null },
      data: { usedAt: expect.any(Date) },
    });
  });

  it("returns invalid_token when the token does not exist", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);

    const result = await resetPassword("rawtoken", VALID_PASSWORD);

    expect(result.status).toBe("invalid_token");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns invalid_token when the token is expired", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "user-9",
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });

    const result = await resetPassword("rawtoken", VALID_PASSWORD);

    expect(result.status).toBe("invalid_token");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("returns invalid_token when the token was already used", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "user-9",
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });

    const result = await resetPassword("rawtoken", VALID_PASSWORD);

    expect(result.status).toBe("invalid_token");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });
});

describe("isValidPasswordResetToken", () => {
  it("is true for an unused, unexpired token", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: new Date(Date.now() + 60_000),
    });

    expect(await isValidPasswordResetToken("rawtoken")).toBe(true);
    expect(mockPrisma.passwordResetToken.findUnique).toHaveBeenCalledWith({
      where: { tokenHash: sha256("rawtoken") },
    });
  });

  it("is false for a missing, used, or expired token", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue(null);
    expect(await isValidPasswordResetToken("x")).toBe(false);

    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      usedAt: new Date(),
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect(await isValidPasswordResetToken("x")).toBe(false);

    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      usedAt: null,
      expiresAt: new Date(Date.now() - 1000),
    });
    expect(await isValidPasswordResetToken("x")).toBe(false);
  });
});
