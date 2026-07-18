import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPostLoginRedirect } from "./getPostLoginRedirect";

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    allianceMembership: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/app/src/lib/betaInvitation", () => ({
  getPendingAllianceCreation: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/identity/eligibility", () => ({
  isInvitationEligible: vi.fn(),
}));

vi.mock("@/app/src/lib/allianceSetup", () => ({
  getAllianceSetupStatus: vi.fn(),
}));

import { prisma } from "@/app/src/lib/prisma";
import { getPendingAllianceCreation } from "@/app/src/lib/betaInvitation";
import { isInvitationEligible } from "@/app/src/lib/auth/identity/eligibility";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";

const mockPrisma = prisma as unknown as {
  allianceMembership: { findMany: ReturnType<typeof vi.fn> };
};
const mockGetPendingAllianceCreation = getPendingAllianceCreation as ReturnType<
  typeof vi.fn
>;
const mockIsInvitationEligible = isInvitationEligible as ReturnType<
  typeof vi.fn
>;
const mockGetAllianceSetupStatus = getAllianceSetupStatus as ReturnType<
  typeof vi.fn
>;

const member = { id: "user-1", email: "user@example.com", isPlatformAdmin: false };
const admin = { id: "admin-1", email: "admin@example.com", isPlatformAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no pending work, no alliance.
  mockIsInvitationEligible.mockResolvedValue(false);
  mockGetPendingAllianceCreation.mockResolvedValue(null);
  mockPrisma.allianceMembership.findMany.mockResolvedValue([]);
});

describe("getPostLoginRedirect", () => {
  it("prioritizes a pending invitation over every role and context", async () => {
    // Even a platform admin with a pending invitation must redeem it first.
    mockIsInvitationEligible.mockResolvedValue(true);

    await expect(getPostLoginRedirect(admin)).resolves.toBe("/redeem");
    // State wins before any role/alliance lookup.
    expect(mockPrisma.allianceMembership.findMany).not.toHaveBeenCalled();
  });

  it("routes a user mid-onboarding (accepted beta, no alliance) to /create-alliance", async () => {
    mockGetPendingAllianceCreation.mockResolvedValue({ id: "beta-1" });

    await expect(getPostLoginRedirect(member)).resolves.toBe("/create-alliance");
  });

  it("onboarding takes precedence over the platform console", async () => {
    mockGetPendingAllianceCreation.mockResolvedValue({ id: "beta-1" });

    await expect(getPostLoginRedirect(admin)).resolves.toBe("/create-alliance");
  });

  it("routes a platform admin with no pending work to the operations center", async () => {
    await expect(getPostLoginRedirect(admin)).resolves.toBe("/platform/overview");
    // Admin (no pending work) short-circuits before any alliance lookup.
    expect(mockPrisma.allianceMembership.findMany).not.toHaveBeenCalled();
  });

  it("defaults an admin who also has an alliance to the console (role before context)", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "OWNER" },
    ]);

    await expect(getPostLoginRedirect(admin)).resolves.toBe("/platform/overview");
  });

  it("routes an owner with incomplete setup to the setup page", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "OWNER" },
    ]);
    mockGetAllianceSetupStatus.mockResolvedValue({ isComplete: false });

    await expect(getPostLoginRedirect(member)).resolves.toBe(
      "/alliances/alliance-1/setup"
    );
  });

  it("routes an owner with complete setup to the alliance", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "OWNER" },
    ]);
    mockGetAllianceSetupStatus.mockResolvedValue({ isComplete: true });

    await expect(getPostLoginRedirect(member)).resolves.toBe(
      "/alliances/alliance-1"
    );
  });

  it("routes a non-owner member straight to the alliance (no setup check)", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "VIEWER" },
    ]);

    await expect(getPostLoginRedirect(member)).resolves.toBe(
      "/alliances/alliance-1"
    );
    expect(mockGetAllianceSetupStatus).not.toHaveBeenCalled();
  });

  it("routes a multi-alliance member to the alliance selector", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "OWNER" },
      { allianceId: "alliance-2", role: "VIEWER" },
    ]);

    await expect(getPostLoginRedirect(member)).resolves.toBe(
      "/alliances/select_alliance"
    );
  });

  it("falls back to /redeem when nothing is actionable and there is no alliance", async () => {
    // Not admin, no pending invite/creation, no membership.
    await expect(getPostLoginRedirect(member)).resolves.toBe("/redeem");
  });
});
