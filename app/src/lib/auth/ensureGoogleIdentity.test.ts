import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";
import { ensureGoogleIdentity } from "./ensureGoogleIdentity";
import { GoogleAccountMismatchError } from "./identity/errors";

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    user: {
      updateMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@/app/src/lib/prisma";

const mockPrisma = prisma as unknown as {
  user: {
    updateMany: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureGoogleIdentity", () => {
  it("links the subject with a guarded write on first Google sign-in", async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    await ensureGoogleIdentity(
      { id: "user-1", googleSubject: null },
      "google-sub-1"
    );

    // Guarded: only update while still unanchored, so a concurrent anchor is
    // never clobbered.
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", googleSubject: null },
      data: { googleSubject: "google-sub-1" },
    });
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("is a no-op when already anchored to the same subject", async () => {
    await ensureGoogleIdentity(
      { id: "user-1", googleSubject: "google-sub-1" },
      "google-sub-1"
    );

    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("throws when the anchored subject differs", async () => {
    await expect(
      ensureGoogleIdentity(
        { id: "user-1", googleSubject: "google-sub-1" },
        "google-sub-2"
      )
    ).rejects.toBeInstanceOf(GoogleAccountMismatchError);

    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("allows when a concurrent sign-in anchored the same subject (TOCTOU, idempotent)", async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.findUnique.mockResolvedValue({ googleSubject: "google-sub-1" });

    await expect(
      ensureGoogleIdentity({ id: "user-1", googleSubject: null }, "google-sub-1")
    ).resolves.toBeUndefined();

    expect(mockPrisma.user.findUnique).toHaveBeenCalledWith({
      where: { id: "user-1" },
      select: { googleSubject: true },
    });
  });

  it("throws when a concurrent sign-in anchored a different subject (TOCTOU)", async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.findUnique.mockResolvedValue({ googleSubject: "google-sub-2" });

    await expect(
      ensureGoogleIdentity({ id: "user-1", googleSubject: null }, "google-sub-1")
    ).rejects.toBeInstanceOf(GoogleAccountMismatchError);
  });

  it("throws when the row disappeared before the guarded write", async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      ensureGoogleIdentity({ id: "user-1", googleSubject: null }, "google-sub-1")
    ).rejects.toBeInstanceOf(GoogleAccountMismatchError);
  });

  it("throws when the subject is already anchored to another user (P2002)", async () => {
    mockPrisma.user.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    await expect(
      ensureGoogleIdentity(
        { id: "user-1", googleSubject: null },
        "google-sub-taken"
      )
    ).rejects.toBeInstanceOf(GoogleAccountMismatchError);
  });

  it("rethrows unexpected errors", async () => {
    mockPrisma.user.updateMany.mockRejectedValue(new Error("db down"));

    await expect(
      ensureGoogleIdentity({ id: "user-1", googleSubject: null }, "google-sub-1")
    ).rejects.toThrow("db down");
  });
});
