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

// Length-only policy (main's password.ts): ≥8 chars, no complexity rules.
const VALID_PASSWORD = "correct horse";
const EIGHT_CHARS = "abcdefgh";
// 20 four-byte emoji = 80 UTF-8 bytes > the 72-byte bcrypt cap, though only 40
// JS characters — must be rejected by the byte-length rule, not slip through.
const TOO_MANY_BYTES = "😀".repeat(20);

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

beforeEach(() => {
  vi.clearAllMocks();
  // A successful conditional claim affects exactly one row.
  mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.passwordResetToken.create.mockResolvedValue({});
  mockPrisma.user.update.mockResolvedValue({});
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
    const result = await resetPassword("rawtoken", "short");

    expect(result.status).toBe("invalid_password");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.passwordResetToken.findUnique).not.toHaveBeenCalled();
  });

  it("accepts an 8-character password with no complexity (length-only policy)", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "user-9",
    });

    const result = await resetPassword("rawtoken", EIGHT_CHARS);

    expect(result.status).toBe("success");
  });

  it("rejects a multibyte password exceeding 72 UTF-8 bytes", async () => {
    const result = await resetPassword("rawtoken", TOO_MANY_BYTES);

    expect(result.status).toBe("invalid_password");
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });

  it("sets the new password, bumps sessionVersion, and invalidates tokens", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "user-9",
    });

    const result = await resetPassword("rawtoken", VALID_PASSWORD);

    expect(result.status).toBe("success");

    // Guarded single-use claim: unused AND unexpired, by token id.
    expect(mockPrisma.passwordResetToken.updateMany).toHaveBeenCalledWith({
      where: { id: "t1", usedAt: null, expiresAt: { gt: expect.any(Date) } },
      data: { usedAt: expect.any(Date) },
    });

    // Password replaced AND every existing session revoked in one write.
    const updateArg = mockPrisma.user.update.mock.calls[0][0];
    expect(updateArg.where).toEqual({ id: "user-9" });
    expect(updateArg.data.sessionVersion).toEqual({ increment: 1 });
    expect(await bcrypt.compare(VALID_PASSWORD, updateArg.data.passwordHash)).toBe(
      true
    );

    // Sibling tokens for the user are invalidated too.
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

  it("returns invalid_token when the guarded claim affects no rows (expired/used/raced)", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "user-9",
    });
    // The conditional claim finds nothing to update: the token was already used
    // or has expired — including the concurrent double-use race, where a second
    // request loses the claim.
    mockPrisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

    const result = await resetPassword("rawtoken", VALID_PASSWORD);

    expect(result.status).toBe("invalid_token");
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("cannot be consumed twice concurrently: only the first claim wins", async () => {
    mockPrisma.passwordResetToken.findUnique.mockResolvedValue({
      id: "t1",
      userId: "user-9",
    });
    // First claim succeeds (count 1); every subsequent claim sees count 0.
    mockPrisma.passwordResetToken.updateMany
      .mockResolvedValueOnce({ count: 1 }) // winner's claim
      .mockResolvedValue({ count: 0 }); // winner's sibling sweep + loser's claim

    const [first, second] = await Promise.all([
      resetPassword("rawtoken", VALID_PASSWORD),
      resetPassword("rawtoken", VALID_PASSWORD),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["invalid_token", "success"]);
    // Exactly one password write happened.
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
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
