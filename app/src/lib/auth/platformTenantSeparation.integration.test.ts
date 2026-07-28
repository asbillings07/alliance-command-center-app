import { describe, it, expect, beforeEach, afterEach, vi, beforeAll } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

/**
 * Platform / Tenant Authorization Separation [integration]
 *
 * Proves that platform admin status alone does not grant tenant route access.
 * Alliance authorization requires AllianceMembership regardless of isPlatformAdmin.
 *
 * @tags @integration
 */

vi.mock("@/app/src/lib/auth/requireAuth", () => ({
  requireAuth: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("Platform / Tenant Authorization Separation [integration]", () => {
  let prisma: PrismaClient;
  let requireAllianceAccess: typeof import("./requireAllianceAccess").requireAllianceAccess;

  let platformAdminUserId: string;
  let testAllianceId: string;

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ requireAllianceAccess } = await import("./requireAllianceAccess"));
  });

  beforeEach(async () => {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    const user = await prisma.user.create({
      data: {
        email: `platform-admin-${suffix}@test.local`,
        passwordHash: "dummy-hash",
        displayName: `Platform Admin ${suffix}`,
        isPlatformAdmin: true,
      },
    });
    platformAdminUserId = user.id;

    const alliance = await prisma.alliance.create({
      data: {
        name: `Test Alliance ${suffix}`,
        server: "9999",
      },
    });
    testAllianceId = alliance.id;

    const { requireAuth } = await import("@/app/src/lib/auth/requireAuth");
    vi.mocked(requireAuth).mockResolvedValue({
      id: platformAdminUserId,
      email: user.email,
    });
  });

  afterEach(async () => {
    await prisma.alliance.deleteMany({ where: { id: testAllianceId } });
    await prisma.user.deleteMany({ where: { id: platformAdminUserId } });

    platformAdminUserId = "";
    testAllianceId = "";
  });

  it("requireAllianceAccess denies platform admins without alliance membership", async () => {
    await expect(
      requireAllianceAccess({
        allianceId: testAllianceId,
        requiredPermission: undefined,
      })
    ).rejects.toThrow();
  });
});
