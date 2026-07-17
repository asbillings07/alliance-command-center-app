/* eslint-disable react-hooks/rules-of-hooks */
import { test as base, expect, Page } from "@playwright/test";

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

export type TestFixtures = {
  testUser: TestUser;
  login: (user: TestUser) => Promise<void>;
  register: (user: TestUser, betaCode?: string) => Promise<void>;
  createBetaInvite: (email: string) => Promise<{ code: string; token: string }>;
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
      await page.click('button[type="submit"]');
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
