import { describe, it, expect, vi, beforeEach } from "vitest";
import { getPostLoginRedirect } from "./getPostLoginRedirect";

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    allianceMembership: {
      findMany: vi.fn(),
    },
    invitation: {
      findFirst: vi.fn(),
    },
  },
}));

vi.mock("@/app/src/lib/betaInvitation", () => ({
  getPendingAllianceCreation: vi.fn(),
  getPendingInvitation: vi.fn(),
}));

vi.mock("@/app/src/lib/allianceSetup", () => ({
  getAllianceSetupStatus: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({
  isPlatformAdmin: vi.fn(),
}));

import { prisma } from "@/app/src/lib/prisma";
import {
  getPendingAllianceCreation,
  getPendingInvitation,
} from "@/app/src/lib/betaInvitation";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import { isPlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";

const mockPrisma = prisma as unknown as {
  allianceMembership: { findMany: ReturnType<typeof vi.fn> };
  invitation: { findFirst: ReturnType<typeof vi.fn> };
};
const mockGetPendingAllianceCreation = getPendingAllianceCreation as ReturnType<
  typeof vi.fn
>;
const mockGetPendingInvitation = getPendingInvitation as ReturnType<
  typeof vi.fn
>;
const mockGetAllianceSetupStatus = getAllianceSetupStatus as ReturnType<
  typeof vi.fn
>;
const mockIsPlatformAdmin = isPlatformAdmin as ReturnType<typeof vi.fn>;

const member = { id: "user-1", email: "user@example.com", isPlatformAdmin: false };
const admin = { id: "admin-1", email: "admin@example.com", isPlatformAdmin: true };

beforeEach(() => {
  vi.clearAllMocks();
  // Default: no pending work, no alliance.
  mockGetPendingInvitation.mockResolvedValue(null);
  mockGetPendingAllianceCreation.mockResolvedValue(null);
  mockPrisma.allianceMembership.findMany.mockResolvedValue([]);
  mockPrisma.invitation.findFirst.mockResolvedValue(null);
  // Default: the DB agrees with the admin hint (no mid-session revocation).
  mockIsPlatformAdmin.mockResolvedValue(true);
});

describe("getPostLoginRedirect", () => {
  it("prioritizes a pending beta invitation over every role and context", async () => {
    // Even a platform admin with a pending beta invitation must redeem it first.
    mockGetPendingInvitation.mockResolvedValue({ id: "beta-1" });

    await expect(getPostLoginRedirect(admin)).resolves.toBe("/redeem");
    // State wins before any role/alliance lookup.
    expect(mockPrisma.allianceMembership.findMany).not.toHaveBeenCalled();
  });

  it("routes a pending alliance collaborator invite to the invite flow, not /redeem", async () => {
    // No beta invite, no pending creation, not admin, no membership.
    mockPrisma.invitation.findFirst.mockResolvedValue({ token: "tok_abc" });

    await expect(getPostLoginRedirect(member)).resolves.toBe("/invite/tok_abc");
    expect(mockPrisma.invitation.findFirst).toHaveBeenCalledWith({
      where: {
        email: { equals: "user@example.com", mode: "insensitive" },
        acceptedAt: null,
        cancelledAt: null,
        expiresAt: { gt: expect.any(Date) },
      },
      orderBy: { createdAt: "desc" },
      select: { token: true },
    });
  });

  it("does not hijack an existing member who also has a pending alliance invite", async () => {
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "VIEWER" },
    ]);
    mockPrisma.invitation.findFirst.mockResolvedValue({ token: "tok_abc" });

    await expect(getPostLoginRedirect(member)).resolves.toBe(
      "/alliances/alliance-1"
    );
    // Membership wins; the alliance-invite lookup is never reached.
    expect(mockPrisma.invitation.findFirst).not.toHaveBeenCalled();
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

  it("confirms admin against the DB before returning the console (hint alone is not enough)", async () => {
    await expect(getPostLoginRedirect(admin)).resolves.toBe("/platform/overview");
    expect(mockIsPlatformAdmin).toHaveBeenCalledWith(admin.id);
  });

  it("falls through to real state when the admin hint is stale (revoked mid-session)", async () => {
    // Hint says admin, but the DB no longer agrees. Returning the console here
    // would ping-pong /app <-> /platform/overview forever, so we route by the
    // user's actual state instead.
    mockIsPlatformAdmin.mockResolvedValue(false);
    mockPrisma.allianceMembership.findMany.mockResolvedValue([
      { allianceId: "alliance-1", role: "VIEWER" },
    ]);

    await expect(getPostLoginRedirect(admin)).resolves.toBe(
      "/alliances/alliance-1"
    );
  });

  it("does not query admin status for a non-admin (lookup only for hinted admins)", async () => {
    await expect(getPostLoginRedirect(member)).resolves.toBe("/redeem");
    expect(mockIsPlatformAdmin).not.toHaveBeenCalled();
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
