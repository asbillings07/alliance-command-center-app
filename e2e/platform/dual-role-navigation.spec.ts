import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import bcrypt from "bcrypt";

/**
 * Dual-role operator navigation E2E tests (#164).
 *
 * Each test creates its own platform-admin user and alliance fixture(s),
 * never mutating shared seeded users.
 */

type DualRoleFixture = {
  email: string;
  password: string;
  userId: string;
  allianceIds: string[];
};

async function createDualRoleFixture(options: {
  suffix: string;
  membershipCount: number;
}): Promise<DualRoleFixture> {
  const { suffix, membershipCount } = options;
  const email = `dual-role-${suffix}@test.local`;
  const password = "Test1234";
  const passwordHash = await bcrypt.hash(password, 10);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      displayName: `Dual Role ${suffix}`,
      isPlatformAdmin: true,
    },
  });

  const allianceIds: string[] = [];

  for (let i = 0; i < membershipCount; i += 1) {
    const alliance = await prisma.alliance.create({
      data: {
        name: `Dual Role Alliance ${suffix}-${i + 1}`,
        server: "9999",
      },
    });
    allianceIds.push(alliance.id);

    await prisma.allianceMembership.create({
      data: {
        allianceId: alliance.id,
        userId: user.id,
        role: "VIEWER",
      },
    });
  }

  return { email, password, userId: user.id, allianceIds };
}

async function cleanupDualRoleFixture(fixture: DualRoleFixture) {
  for (const allianceId of fixture.allianceIds) {
    await prisma.memberMetricEntry.deleteMany({
      where: { allianceMember: { allianceId } },
    });
    await prisma.metricPeriodMetric.deleteMany({
      where: { period: { allianceId } },
    });
    await prisma.allianceMember.deleteMany({ where: { allianceId } });
    await prisma.metric.deleteMany({ where: { allianceId } });
    await prisma.metricPeriod.deleteMany({ where: { allianceId } });
    await prisma.invitation.deleteMany({ where: { allianceId } });
    await prisma.allianceMembership.deleteMany({ where: { allianceId } });
    await prisma.alliance.delete({ where: { id: allianceId } });
  }

  await prisma.allianceMembership.deleteMany({ where: { userId: fixture.userId } });
  await prisma.user.delete({ where: { id: fixture.userId } });
}

async function loginDualRoleUser(
  page: import("@playwright/test").Page,
  fixture: DualRoleFixture
) {
  await page.goto("/login");
  await page.getByLabel(/email/i).fill(fixture.email);
  await page.getByLabel(/password/i).fill(fixture.password);
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.waitForURL(/\/(app|alliances|platform)/);
}

test.describe("Dual-role operator navigation", () => {
  test.describe.configure({ mode: "serial" });

  test("round-trips between Platform Console and alliance workspace", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await createDualRoleFixture({ suffix, membershipCount: 1 });

    try {
      await loginDualRoleUser(page, fixture);
      await page.waitForURL("/platform/overview");

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.getByRole("link", { name: "Alliance workspace", exact: true }).click();
      await page.waitForURL(new RegExp(`/alliances/${fixture.allianceIds[0]}(/|$)`));

      expect(page.url()).toMatch(
        new RegExp(`/alliances/${fixture.allianceIds[0]}(/|$)`)
      );

      await page.getByRole("link", { name: "Platform Console", exact: true }).click();
      await page.waitForURL("/platform/overview");
      expect(page.url()).toContain("/platform/overview");
    } finally {
      await cleanupDualRoleFixture(fixture);
    }
  });

  test("routes multi-alliance operators to the alliance selector", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await createDualRoleFixture({ suffix, membershipCount: 2 });

    try {
      await loginDualRoleUser(page, fixture);
      await page.waitForURL("/platform/overview");
      await page.setViewportSize({ width: 1280, height: 800 });

      await expect(
        page.getByRole("link", { name: "My alliances", exact: true })
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: "Alliance workspace", exact: true })
      ).toHaveCount(0);

      await page.getByRole("link", { name: "My alliances", exact: true }).click();
      await page.waitForURL("/alliances/select_alliance");
      expect(page.url()).toContain("/alliances/select_alliance");
    } finally {
      await cleanupDualRoleFixture(fixture);
    }
  });

  test("hides workspace link after membership revocation and avoids redirect loops", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 8)}`;
    const fixture = await createDualRoleFixture({ suffix, membershipCount: 1 });
    const allianceId = fixture.allianceIds[0];

    try {
      await loginDualRoleUser(page, fixture);
      await page.waitForURL("/platform/overview");
      await page.setViewportSize({ width: 1280, height: 800 });

      await expect(
        page.getByRole("link", { name: "Alliance workspace", exact: true })
      ).toBeVisible();

      await prisma.allianceMembership.deleteMany({
        where: { userId: fixture.userId, allianceId },
      });

      await page.reload();
      await page.waitForURL("/platform/overview");

      await expect(
        page.getByRole("link", { name: "Alliance workspace", exact: true })
      ).toHaveCount(0);
      await expect(
        page.getByRole("link", { name: "My alliances", exact: true })
      ).toHaveCount(0);

      await page.goto(`/alliances/${allianceId}`);
      await page.waitForURL("/app", { timeout: 15000 });
      expect(page.url()).toMatch(/\/app$/);
    } finally {
      await cleanupDualRoleFixture(fixture);
    }
  });
});
