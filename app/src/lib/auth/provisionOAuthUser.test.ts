import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";
import { provisionOAuthUser } from "./provisionOAuthUser";

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/app/src/lib/prisma";

const mockPrisma = prisma as unknown as {
  user: {
    findUnique: ReturnType<typeof vi.fn>;
    create: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("provisionOAuthUser", () => {
  it("returns the existing user without creating", async () => {
    const existing = { id: "user-1", email: "user@example.com" };
    mockPrisma.user.findUnique.mockResolvedValue(existing);

    const result = await provisionOAuthUser({
      email: "User@Example.com",
      displayName: "User",
      googleSubject: "google-sub-1",
    });

    expect(result).toBe(existing);
    expect(mockPrisma.user.create).not.toHaveBeenCalled();
    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { email: "user@example.com" },
    });
  });

  it("creates a new user anchored to the Google subject and no password", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.user.create.mockImplementation(async ({ data }) => ({
      id: "user-2",
      ...data,
    }));

    const result = await provisionOAuthUser({
      email: "new@example.com",
      displayName: "New User",
      googleSubject: "google-sub-2",
    });

    expect(mockPrisma.user.create).toHaveBeenCalledWith({
      data: {
        email: "new@example.com",
        displayName: "New User",
        passwordHash: null,
        googleSubject: "google-sub-2",
      },
    });
    expect(result.googleSubject).toBe("google-sub-2");
    expect(result.passwordHash).toBeNull();
  });

  it("recovers from a concurrent create (P2002) by re-fetching", async () => {
    const raced = { id: "user-3", email: "race@example.com" };
    mockPrisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(raced);
    mockPrisma.user.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    const result = await provisionOAuthUser({
      email: "race@example.com",
      displayName: "Race",
      googleSubject: "google-sub-3",
    });

    expect(result).toBe(raced);
    expect(mockPrisma.user.findUnique).toHaveBeenCalledTimes(2);
  });
});
