import { test, expect } from "./fixtures";
import {
  PERMISSION_MATRIX,
  type Role,
  type FeaturePermission,
} from "./permission-matrix";

/**
 * Permission Matrix Validation Tests
 *
 * These tests validate that the UI correctly reflects the permission system.
 * Each test uses pre-seeded test users with specific roles.
 *
 * Required environment variables:
 *   TEST_ALLIANCE_ID    - ID of the test alliance
 *   TEST_PERIOD_ID      - ID of a test period (for record/import tests)
 *   TEST_MEMBER_ID      - ID of a test member (for member detail tests)
 *   TEST_OWNER_EMAIL    - Email of OWNER test user
 *   TEST_OWNER_PASSWORD - Password of OWNER test user
 *   TEST_ADMIN_EMAIL    - Email of ADMIN test user
 *   TEST_ADMIN_PASSWORD - Password of ADMIN test user
 *   TEST_LEADER_EMAIL   - Email of LEADER test user
 *   TEST_LEADER_PASSWORD - Password of LEADER test user
 *   TEST_VIEWER_EMAIL   - Email of VIEWER test user
 *   TEST_VIEWER_PASSWORD - Password of VIEWER test user
 */

const TEST_ALLIANCE_ID = process.env.TEST_ALLIANCE_ID || "test-alliance";
const TEST_PERIOD_ID = process.env.TEST_PERIOD_ID || "test-period";
const TEST_MEMBER_ID = process.env.TEST_MEMBER_ID || "test-member";

type TestUserConfig = {
  email: string;
  password: string;
};

const TEST_USERS: Record<Role, TestUserConfig> = {
  OWNER: {
    email: process.env.TEST_OWNER_EMAIL || "owner@test.com",
    password: process.env.TEST_OWNER_PASSWORD || "Password123",
  },
  ADMIN: {
    email: process.env.TEST_ADMIN_EMAIL || "admin@test.com",
    password: process.env.TEST_ADMIN_PASSWORD || "Password123",
  },
  LEADER: {
    email: process.env.TEST_LEADER_EMAIL || "leader@test.com",
    password: process.env.TEST_LEADER_PASSWORD || "Password123",
  },
  VIEWER: {
    email: process.env.TEST_VIEWER_EMAIL || "viewer@test.com",
    password: process.env.TEST_VIEWER_PASSWORD || "Password123",
  },
};

function substitutePath(path: string): string {
  return path
    .replace("{allianceId}", TEST_ALLIANCE_ID)
    .replace("{periodId}", TEST_PERIOD_ID)
    .replace("{memberId}", TEST_MEMBER_ID);
}

async function loginAsRole(
  page: import("@playwright/test").Page,
  role: Role
): Promise<void> {
  const user = TEST_USERS[role];
  await page.goto("/login");
  await page.fill('input[name="email"]', user.email);
  await page.fill('input[name="password"]', user.password);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/(app|alliances|platform)/);
}

test.describe("Permission Matrix Validation", () => {
  /**
   * Generate tests for each role
   */
  for (const role of ["OWNER", "ADMIN", "LEADER", "VIEWER"] as Role[]) {
    test.describe(`Role: ${role}`, () => {
      test.beforeEach(async ({ page }) => {
        await loginAsRole(page, role);
      });

      /**
       * Test page accessibility for this role
       */
      const pageChecks = PERMISSION_MATRIX.filter(
        (p) => p.verification.type === "page_accessible"
      );

      for (const check of pageChecks) {
        const shouldAccess = check.expected[role];
        const testName = shouldAccess
          ? `can access: ${check.description}`
          : `cannot access: ${check.description}`;

        test(testName, async ({ page }) => {
          const path = substitutePath(
            (check.verification as { path: string }).path
          );
          await page.goto(path);

          if (shouldAccess) {
            // Should stay on the page (not redirected to /app or /login)
            const url = page.url();
            expect(url).toContain(path.split("?")[0]);
          } else {
            // Should be redirected away from the page
            await page.waitForURL((url) => !url.pathname.includes(path));
            const url = page.url();
            expect(url).not.toContain(path);
          }
        });
      }

      /**
       * Test UI element visibility for this role
       */
      const uiChecks = PERMISSION_MATRIX.filter(
        (p) => p.verification.type !== "page_accessible"
      );

      for (const check of uiChecks) {
        const shouldBeVisible = check.expected[role];

        // Skip UI visibility checks for pages the role can't access
        const pageAccessible = PERMISSION_MATRIX.find(
          (p) =>
            p.verification.type === "page_accessible" &&
            (p.verification as { path: string }).path ===
              (check.verification as { onPage: string }).onPage
        );

        if (pageAccessible && !pageAccessible.expected[role]) {
          continue;
        }

        const testName = shouldBeVisible
          ? `sees: ${check.description}`
          : `does not see: ${check.description}`;

        test(testName, async ({ page }) => {
          const verification = check.verification as {
            selector: string;
            onPage: string;
          };
          const pagePath = substitutePath(verification.onPage);

          await page.goto(pagePath);

          // Wait for page to load
          await page.waitForLoadState("networkidle");

          const element = page.locator(verification.selector).first();

          if (shouldBeVisible) {
            await expect(element).toBeVisible({ timeout: 5000 });
          } else {
            await expect(element).not.toBeVisible({ timeout: 5000 });
          }
        });
      }
    });
  }

  /**
   * Platform Admin Tests (separate from alliance roles)
   */
  test.describe("Platform Admin", () => {
    test("platform admin can access /platform", async ({ page }) => {
      // Login as platform admin (the OWNER in test data should also be platform admin)
      const platformAdminEmail =
        process.env.TEST_PLATFORM_ADMIN_EMAIL || "abdevelops@gmail.com";
      const platformAdminPassword =
        process.env.TEST_PLATFORM_ADMIN_PASSWORD || "Password123";

      await page.goto("/login");
      await page.fill('input[name="email"]', platformAdminEmail);
      await page.fill('input[name="password"]', platformAdminPassword);
      await page.click('button[type="submit"]');
      await page.waitForURL(/\/(app|alliances|platform)/);

      await page.goto("/platform");
      await expect(
        page.locator("h1:has-text('Platform Dashboard')")
      ).toBeVisible();
    });

    test("non-platform-admin cannot access /platform", async ({ page }) => {
      // Login as a regular user who is NOT a platform admin
      await loginAsRole(page, "VIEWER");
      await page.goto("/platform");

      // Should be redirected to /app
      await page.waitForURL(/\/app/);
      expect(page.url()).toContain("/app");
    });
  });
});

/**
 * Summary test - validates the entire matrix at once
 */
test.describe("Permission Matrix Summary", () => {
  test("all roles have correct permission counts", () => {
    const summary = {
      OWNER: 0,
      ADMIN: 0,
      LEADER: 0,
      VIEWER: 0,
    };

    for (const check of PERMISSION_MATRIX) {
      for (const role of Object.keys(summary) as Role[]) {
        if (check.expected[role]) {
          summary[role]++;
        }
      }
    }

    // These counts should match the permission system
    // OWNER has most permissions
    expect(summary.OWNER).toBeGreaterThanOrEqual(summary.ADMIN);
    // ADMIN has more than LEADER
    expect(summary.ADMIN).toBeGreaterThanOrEqual(summary.LEADER);
    // LEADER has more than VIEWER
    expect(summary.LEADER).toBeGreaterThanOrEqual(summary.VIEWER);
    // VIEWER has minimal permissions
    expect(summary.VIEWER).toBeGreaterThan(0);

    console.log("Permission Summary:", summary);
  });

  test("platform dashboard is denied to all alliance roles", () => {
    const platformCheck = PERMISSION_MATRIX.find(
      (p) => p.feature === "platform.dashboard"
    );

    expect(platformCheck).toBeDefined();
    expect(platformCheck?.expected.OWNER).toBe(false);
    expect(platformCheck?.expected.ADMIN).toBe(false);
    expect(platformCheck?.expected.LEADER).toBe(false);
    expect(platformCheck?.expected.VIEWER).toBe(false);
  });
});
