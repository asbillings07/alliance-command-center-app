import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";
import { ensureGoogleIdentity } from "./ensureGoogleIdentity";
import { GoogleAccountMismatchError } from "./identity/errors";

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    user: {
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@/app/src/lib/prisma";

const mockPrisma = prisma as unknown as {
  user: {
    update: ReturnType<typeof vi.fn>;
  };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ensureGoogleIdentity", () => {
  it("links the subject on first Google sign-in (no anchor yet)", async () => {
    mockPrisma.user.update.mockResolvedValue({});

    await ensureGoogleIdentity(
      { id: "user-1", googleSubject: null },
      "google-sub-1"
    );

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { googleSubject: "google-sub-1" },
    });
  });

  it("is a no-op when already anchored to the same subject", async () => {
    await ensureGoogleIdentity(
      { id: "user-1", googleSubject: "google-sub-1" },
      "google-sub-1"
    );

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("throws when the anchored subject differs", async () => {
    await expect(
      ensureGoogleIdentity(
        { id: "user-1", googleSubject: "google-sub-1" },
        "google-sub-2"
      )
    ).rejects.toBeInstanceOf(GoogleAccountMismatchError);

    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it("throws when the subject is already anchored to another user (P2002)", async () => {
    mockPrisma.user.update.mockRejectedValue(
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
    mockPrisma.user.update.mockRejectedValue(new Error("db down"));

    await expect(
      ensureGoogleIdentity({ id: "user-1", googleSubject: null }, "google-sub-1")
    ).rejects.toThrow("db down");
  });
});
