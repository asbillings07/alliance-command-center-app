import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { Permissions } from "./permissions";

/**
 * Privilege Separation Integration Tests
 *
 * Proves that ACC authorization depends exclusively on AllianceMembership.role,
 * not on AllianceMember.role (in-game rank metadata).
 *
 * These tests exercise the real requireAllianceAccess() boundary with only
 * requireAuth() mocked, proving the server query path ignores descriptive
 * roster metadata.
 *
 * @tags @integration
 */

// Mock only requireAuth, not the entire authorization path
vi.mock("@/app/src/lib/auth/requireAuth", () => ({
  requireAuth: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("Privilege Separation [integration]", () => {
  let prisma: PrismaClient;
  let requireAllianceAccess: typeof import("./requireAllianceAccess").requireAllianceAccess;
  let requireAuth: any;

  let testUserId: string;
  let testAllianceId: string;
  let testMemberId: string;

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ requireAllianceAccess } = await import("./requireAllianceAccess"));
    ({ requireAuth } = await import("@/app/src/lib/auth/requireAuth"));
  });

  beforeEach(async () => {
    // Create test user
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const user = await prisma.user.create({
      data: {
        email: `test-${suffix}@test.local`,
        passwordHash: "dummy-hash",
        displayName: `Test User ${suffix}`,
      },
    });
    testUserId = user.id;

    // Create test alliance
    const alliance = await prisma.alliance.create({
      data: {
        name: `Test Alliance ${suffix}`,
        server: "9999",
      },
    });
    testAllianceId = alliance.id;

    // Create VIEWER membership (low privilege)
    await prisma.allianceMembership.create({
      data: {
        allianceId: testAllianceId,
        userId: testUserId,
        role: "VIEWER",
      },
    });

    // Mock requireAuth to return our test user
    requireAuth.mockResolvedValue({ id: testUserId });
  });

  afterEach(async () => {
    // Cleanup
    if (testMemberId) {
      await prisma.allianceMember.deleteMany({ where: { id: testMemberId } });
    }
    await prisma.allianceMembership.deleteMany({ where: { userId: testUserId } });
    await prisma.alliance.deleteMany({ where: { id: testAllianceId } });
    await prisma.user.deleteMany({ where: { id: testUserId } });

    testMemberId = "";
    testUserId = "";
    testAllianceId = "";
  });

  it("requireAllianceAccess ignores AllianceMember.role when checking permissions", async () => {
    // 1. Create AllianceMember with role="R5" (in-game rank)
    const member = await prisma.allianceMember.create({
      data: {
        allianceId: testAllianceId,
        playerName: "Test Player",
        userId: testUserId,
        role: "R5", // In-game rank metadata
      },
    });
    testMemberId = member.id;

    // 2. Request CONFIGURE_METRICS with VIEWER membership - should be denied
    // requireAllianceAccess redirects on failure, which throws in tests
    await expect(
      requireAllianceAccess({
        allianceId: testAllianceId,
        requiredPermission: Permissions.CONFIGURE_METRICS,
      })
    ).rejects.toThrow();

    // 3. Change AllianceMember.role to "R4"
    await prisma.allianceMember.update({
      where: { id: testMemberId },
      data: { role: "R4" },
    });

    // 4. Request again - still denied (roster role has no effect)
    await expect(
      requireAllianceAccess({
        allianceId: testAllianceId,
        requiredPermission: Permissions.CONFIGURE_METRICS,
      })
    ).rejects.toThrow();

    // 5. Adversarial: set AllianceMember.role to "OWNER" (as free-form text)
    await prisma.allianceMember.update({
      where: { id: testMemberId },
      data: { role: "OWNER" },
    });

    // 6. Request again - still denied (even with "OWNER" string in roster)
    await expect(
      requireAllianceAccess({
        allianceId: testAllianceId,
        requiredPermission: Permissions.CONFIGURE_METRICS,
      })
    ).rejects.toThrow();

    // 7. Change AllianceMembership.role to ADMIN (the real authorization field)
    await prisma.allianceMembership.update({
      where: {
        allianceId_userId: {
          allianceId: testAllianceId,
          userId: testUserId,
        },
      },
      data: { role: "ADMIN" },
    });

    // 8. Request again - now succeeds
    const result = await requireAllianceAccess({
      allianceId: testAllianceId,
      requiredPermission: Permissions.CONFIGURE_METRICS,
    });
    expect(result.permissions.canConfigureMetrics).toBe(true);
    expect(result.membership.role).toBe("ADMIN");
  });

  it("authorization works correctly when AllianceMember does not exist", async () => {
    // User has VIEWER membership but no AllianceMember roster entry
    // Authorization should still work based on AllianceMembership alone

    await expect(
      requireAllianceAccess({
        allianceId: testAllianceId,
        requiredPermission: Permissions.CONFIGURE_METRICS,
      })
    ).rejects.toThrow(); // VIEWER cannot configure metrics

    // Upgrade to ADMIN
    await prisma.allianceMembership.update({
      where: {
        allianceId_userId: {
          allianceId: testAllianceId,
          userId: testUserId,
        },
      },
      data: { role: "ADMIN" },
    });

    const result = await requireAllianceAccess({
      allianceId: testAllianceId,
      requiredPermission: Permissions.CONFIGURE_METRICS,
    });
    expect(result.permissions.canConfigureMetrics).toBe(true);
  });

  it("authorization fails when AllianceMembership does not exist, regardless of AllianceMember.role", async () => {
    // Delete the membership
    await prisma.allianceMembership.deleteMany({
      where: { userId: testUserId, allianceId: testAllianceId },
    });

    // Create an AllianceMember with "OWNER" role
    const member = await prisma.allianceMember.create({
      data: {
        allianceId: testAllianceId,
        playerName: "Test Player",
        userId: testUserId,
        role: "OWNER", // Should have zero authorization effect
      },
    });
    testMemberId = member.id;

    // Request should fail - no AllianceMembership means no access
    await expect(
      requireAllianceAccess({
        allianceId: testAllianceId,
        requiredPermission: Permissions.VIEW_ALLIANCE,
      })
    ).rejects.toThrow();
  });
});
