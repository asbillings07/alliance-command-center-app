import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPostLoginRedirect } from "./getPostLoginRedirect";

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
    },
    allianceMembership: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/app/src/lib/betaInvitation", () => ({
  getPendingAllianceCreation: vi.fn(),
}));

vi.mock("@/app/src/lib/allianceSetup", () => ({
  getAllianceSetupStatus: vi.fn(),
}));

import { prisma } from "@/app/src/lib/prisma";
import { getPendingAllianceCreation } from "@/app/src/lib/betaInvitation";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";

const mockPrisma = prisma as unknown as {
  user: { findUnique: ReturnType<typeof vi.fn> };
  allianceMembership: { findMany: ReturnType<typeof vi.fn> };
};
const mockGetPendingAllianceCreation = getPendingAllianceCreation as ReturnType<
  typeof vi.fn
>;
const mockGetAllianceSetupStatus = getAllianceSetupStatus as ReturnType<
  typeof vi.fn
>;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ isPlatformAdmin: false });
  mockPrisma.allianceMembership.findMany.mockResolvedValue([]);
});

describe("getPostLoginRedirect", () => {
  it("routes a platform admin to the operations center", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({ isPlatformAdmin: true });

    await expect(getPostLoginRedirect("admin-1")).resolves.toBe(
      "/platform/overview"
    );
    // Admin decision short-circuits before any alliance lookup.
    expect(mockPrisma.allianceMembership.findMany).not.toHaveBeenCalled();
  });

  it("routes a user with a pending alliance creation to /create-alliance", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([]);
    mockGetPendingAllianceCreation.mockResolvedValue({ id: "beta-1" });

    await expect(getPostLoginRedirect("user-1")).resolves.toBe(
      "/create-alliance"
    );
  });

  it("routes a user with no alliance and no pending creation to /redeem", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([]);
    mockGetPendingAllianceCreation.mockResolvedValue(null);

    await expect(getPostLoginRedirect("user-1")).resolves.toBe("/redeem");
  });

  it("routes an owner with incomplete setup to the setup page", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "OWNER" },
    ]);
    mockGetAllianceSetupStatus.mockResolvedValue({ isComplete: false });

    await expect(getPostLoginRedirect("user-1")).resolves.toBe(
      "/alliances/alliance-1/setup"
    );
  });

  it("routes an owner with complete setup to the alliance", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "OWNER" },
    ]);
    mockGetAllianceSetupStatus.mockResolvedValue({ isComplete: true });

    await expect(getPostLoginRedirect("user-1")).resolves.toBe(
      "/alliances/alliance-1"
    );
  });

  it("routes a non-owner member straight to the alliance (no setup check)", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "VIEWER" },
    ]);

    await expect(getPostLoginRedirect("user-1")).resolves.toBe(
      "/alliances/alliance-1"
    );
    expect(mockGetAllianceSetupStatus).not.toHaveBeenCalled();
  });

  it("routes a multi-alliance member to the alliance selector", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "OWNER" },
      { allianceId: "alliance-2", role: "VIEWER" },
    ]);

    await expect(getPostLoginRedirect("user-1")).resolves.toBe(
      "/alliances/select_alliance"
    );
  });
});
