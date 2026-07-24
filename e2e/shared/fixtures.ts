/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect, Page } from "@playwright/test";
import { prisma } from "@/app/src/lib/prisma";
import bcrypt from "bcrypt";
import crypto from "crypto";

/**
 * E2E Test Fixtures for Alliance Command Center
 *
 * Provides helpers for authentication, navigation, and common test operations.
 * Note: The `use` function in Playwright fixtures is not a React hook.
 */

export type TestUser = {
  email: string;
  password: string;
  displayName: string;
};

export type BetaUserFixture = {
  email: string;
  password: string;
  userId: string;
};

export type AdminScenarioFixture = {
  email: string;
  password: string;
  allianceId: string;
  userId: string;
};

export type LeaderScenarioFixture = {
  email: string;
  password: string;
  allianceId: string;
  userId: string;
};

export type TestFixtures = {
  testUser: TestUser;
  login: (user: TestUser) => Promise<void>;
  register: (user: TestUser, betaCode?: string) => Promise<void>;
  createBetaInvite: (email: string) => Promise<{ code: string; token: string }>;
  betaUser: BetaUserFixture;
  adminScenario: AdminScenarioFixture;
  leaderScenario: LeaderScenarioFixture;
};

function generateTestEmail(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(7);
  return `test-${timestamp}-${random}@example.com`;
}

export const test = base.extend<TestFixtures>({
  testUser: async ({}, use) => {
    const user: TestUser = {
      email: generateTestEmail(),
      password: "TestPassword123!",
      displayName: `Test User ${Date.now()}`,
    };
    await use(user);
  },

  login: async ({ page }, use) => {
    const login = async (user: TestUser) => {
      await page.goto("/login");
      await page.fill('input[name="email"]', user.email);
      await page.fill('input[name="password"]', user.password);
      // Target the credentials button specifically: when Google OAuth is
      // enabled the page also renders a "Continue with Google" submit button.
      await page.click('button[type="submit"]:has-text("Sign In")');
      await page.waitForURL(/\/(app|alliances)/);
    };
    await use(login);
  },

  register: async ({ page }, use) => {
    const register = async (user: TestUser, betaCode?: string) => {
      if (betaCode) {
        await page.goto("/redeem");
        await page.fill('input[placeholder*="ABC"]', betaCode);
        await page.click('button:has-text("Continue")');
        await page.waitForURL(/\/redeem\//);
        await page.click('a:has-text("Create Account")');
      } else {
        await page.goto("/register");
      }

      await page.waitForURL(/\/register/);
      
      // Fill registration form
      const emailInput = page.locator('input[name="email"]');
      if (await emailInput.isEditable()) {
        await emailInput.fill(user.email);
      }
      
      const displayNameInput = page.locator('input[name="displayName"]');
      if (await displayNameInput.isVisible()) {
        await displayNameInput.fill(user.displayName);
      }
      
      await page.fill('input[name="password"]', user.password);
      await page.fill('input[name="confirmPassword"]', user.password);
      await page.click('button[type="submit"]');
    };
    await use(register);
  },

  createBetaInvite: async ({}, use) => {
    const createBetaInvite = async (email: string) => {
      // This would ideally call the API or database directly
      // For now, we'll use a placeholder that tests can override
      throw new Error(
        `createBetaInvite for ${email} requires database access. Use test database seeding.`
      );
    };
    await use(createBetaInvite);
  },

  /**
   * Database-backed fixture: Creates a unique beta user per test attempt.
   * The user has an accepted beta invitation and can proceed directly to /create-alliance.
   * Automatically cleans up all created resources after the test.
   */
  betaUser: async ({}, use, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `beta-${suffix}@test.local`;
    const password = "Test1234";

    // Create user with hashed password
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: `Beta User ${suffix}`,
      },
    });

    // Create accepted beta invitation
    const code = `TST-${suffix.slice(0, 6).toUpperCase()}`;
    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await prisma.betaInvitation.create({
      data: {
        email,
        code,
        token,
        issuedAt: new Date(),
        expiresAt,
        acceptedAt: new Date(), // Already accepted
        acceptedByUserId: user.id,
      },
    });

    await use({ email, password, userId: user.id });

    // Cleanup: delete alliances created by this user, then memberships, invitations, and user
    const memberships = await prisma.allianceMembership.findMany({
      where: { userId: user.id },
      select: { allianceId: true },
    });

    for (const membership of memberships) {
      // Delete alliance-owned data
      await prisma.allianceMember.deleteMany({ where: { allianceId: membership.allianceId } });
      await prisma.metric.deleteMany({ where: { allianceId: membership.allianceId } });
      await prisma.metricPeriod.deleteMany({ where: { allianceId: membership.allianceId } });
      await prisma.allianceMembership.deleteMany({ where: { allianceId: membership.allianceId } });
      await prisma.alliance.delete({ where: { id: membership.allianceId } });
    }

    await prisma.betaInvitation.deleteMany({ where: { email } });
    await prisma.user.delete({ where: { id: user.id } });
  },

  /**
   * Database-backed fixture: Creates an alliance with an ADMIN membership and zero metrics.
   * Used to test that ADMIN can complete the "Configure Metrics" setup task.
   */
  adminScenario: async ({}, use, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `admin-${suffix}@test.local`;
    const password = "Test1234";

    // Create user
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: `Admin ${suffix}`,
      },
    });

    // Create alliance
    const alliance = await prisma.alliance.create({
      data: {
        name: `Admin Test Alliance ${suffix}`,
        server: "9999",
      },
    });

    // Create ADMIN membership
    await prisma.allianceMembership.create({
      data: {
        allianceId: alliance.id,
        userId: user.id,
        role: "ADMIN",
      },
    });

    await use({ email, password, allianceId: alliance.id, userId: user.id });

    // Cleanup
    await prisma.metric.deleteMany({ where: { allianceId: alliance.id } });
    await prisma.metricPeriod.deleteMany({ where: { allianceId: alliance.id } });
    await prisma.allianceMember.deleteMany({ where: { allianceId: alliance.id } });
    await prisma.allianceMembership.deleteMany({ where: { allianceId: alliance.id } });
    await prisma.alliance.delete({ where: { id: alliance.id } });
    await prisma.user.delete({ where: { id: user.id } });
  },

  /**
   * Database-backed fixture: Creates an alliance with a LEADER membership and zero periods.
   * Used to test that LEADER can complete the "Create Evaluation Period" setup task.
   */
  leaderScenario: async ({}, use, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `leader-${suffix}@test.local`;
    const password = "Test1234";

    // Create user
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        displayName: `Leader ${suffix}`,
      },
    });

    // Create alliance
    const alliance = await prisma.alliance.create({
      data: {
        name: `Leader Test Alliance ${suffix}`,
        server: "9999",
      },
    });

    // Create LEADER membership
    await prisma.allianceMembership.create({
      data: {
        allianceId: alliance.id,
        userId: user.id,
        role: "LEADER",
      },
    });

    await use({ email, password, allianceId: alliance.id, userId: user.id });

    // Cleanup
    await prisma.metricPeriod.deleteMany({ where: { allianceId: alliance.id } });
    await prisma.metric.deleteMany({ where: { allianceId: alliance.id } });
    await prisma.allianceMember.deleteMany({ where: { allianceId: alliance.id } });
    await prisma.allianceMembership.deleteMany({ where: { allianceId: alliance.id } });
    await prisma.alliance.delete({ where: { id: alliance.id } });
    await prisma.user.delete({ where: { id: user.id } });
  },
});

export { expect };

/**
 * Page Object helpers
 */
export class AlliancePage {
  constructor(private page: Page) {}

  async navigateToMetrics(allianceId: string) {
    await this.page.goto(`/alliances/${allianceId}/metrics`);
  }

  async navigateToPeriods(allianceId: string) {
    await this.page.goto(`/alliances/${allianceId}/periods`);
  }

  async navigateToMembers(allianceId: string) {
    await this.page.goto(`/alliances/${allianceId}/members`);
  }

  async navigateToSetup(allianceId: string) {
    await this.page.goto(`/alliances/${allianceId}/setup`);
  }

  async navigateToInvitations(allianceId: string) {
    await this.page.goto(`/alliances/${allianceId}/settings/invitations`);
  }

  async createMetric(name: string, type: "NUMERIC" | "BOOLEAN" = "NUMERIC") {
    await this.page.click('button:has-text("Create Metric")');
    await this.page.fill('input[name="name"]', name);
    await this.page.selectOption('select[name="type"]', type);
    await this.page.click('button[type="submit"]:has-text("Create")');
    await this.page.waitForSelector(`text=${name}`);
  }

  async createPeriod(name: string) {
    await this.page.click('button:has-text("Create Period")');
    await this.page.fill('input[name="name"]', name);
    await this.page.click('button[type="submit"]:has-text("Create")');
    await this.page.waitForSelector(`text=${name}`);
  }

  async inviteCollaborator(
    email: string,
    playerName: string,
    role: "ADMIN" | "LEADER" | "VIEWER"
  ) {
    await this.page.fill('input[name="email"]', email);
    await this.page.fill('input[name="playerName"]', playerName);
    await this.page.selectOption('select[name="role"]', role);
    await this.page.click('button[type="submit"]:has-text("Send Invitation")');
  }
}
