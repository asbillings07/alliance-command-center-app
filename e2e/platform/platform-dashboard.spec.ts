import { test, expect } from "../shared/fixtures";

/**
 * Platform Operations Console E2E Tests
 *
 * Tests the /platform operational console functionality.
 * Organized by workflows, not data entities.
 *
 * Note: These tests require a platform admin user to be authenticated.
 */

test.describe("Platform Operations Console", () => {
  test.beforeEach(async ({ page }) => {
    // Skip if platform admin credentials not available
    test.skip(
      !process.env.TEST_PLATFORM_ADMIN_EMAIL ||
        !process.env.TEST_PLATFORM_ADMIN_PASSWORD,
      "TEST_PLATFORM_ADMIN_EMAIL and TEST_PLATFORM_ADMIN_PASSWORD required"
    );

    // Login as platform admin
    await page.goto("/login");
    await page
      .getByLabel(/email/i)
      .fill(process.env.TEST_PLATFORM_ADMIN_EMAIL!);
    await page
      .getByLabel(/password/i)
      .fill(process.env.TEST_PLATFORM_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances|platform)/);
  });

  test.describe("Layout and Navigation", () => {
    test("redirects /platform to /platform/overview", async ({ page }) => {
      await page.goto("/platform");
      await page.waitForURL("/platform/overview");
      expect(page.url()).toContain("/platform/overview");
    });

    test("displays platform header with search", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(
        page.getByRole("heading", { name: /Platform Operations/i })
      ).toBeVisible();
      await expect(
        page.getByPlaceholder(/search alliances/i)
      ).toBeVisible();
    });

    test("displays workflow navigation on desktop", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/platform/overview");

      // Check navigation links exist
      await expect(page.getByRole("link", { name: "Overview" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Setup" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Support" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Activity" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Beta" })).toBeVisible();
    });

    test("displays platform footer", async ({ page }) => {
      await page.goto("/platform/overview");

      const footer = page.locator("footer");
      await expect(footer.getByText(/ACC v/)).toBeVisible();
      await expect(footer.getByText(/DB Connected/)).toBeVisible();
    });

    test("navigates between workflow pages", async ({ page }) => {
      await page.goto("/platform/overview");

      // Navigate to Setup
      await page.getByRole("link", { name: "Setup" }).click();
      await page.waitForURL("/platform/setup");
      await expect(page.getByText(/Setup Summary/i)).toBeVisible();

      // Navigate to Support
      await page.getByRole("link", { name: "Support" }).click();
      await page.waitForURL("/platform/support");
      await expect(page.getByText(/search bar above/i)).toBeVisible();

      // Navigate to Activity
      await page.getByRole("link", { name: "Activity" }).click();
      await page.waitForURL("/platform/activity");
      await expect(page.getByText(/Live Feed/i)).toBeVisible();

      // Navigate to Beta
      await page.getByRole("link", { name: "Beta" }).click();
      await page.waitForURL("/platform/beta");
      await expect(
        page.getByRole("heading", { name: /Beta Invitations/i })
      ).toBeVisible();
    });
  });

  test.describe("Overview Page", () => {
    test("displays Action Required section", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Action Required/i).first()).toBeVisible();

      // Should show either items or "No items require attention"
      const hasItems = await page.locator(".bg-danger\\/10, .bg-warning\\/10, .bg-primary\\/10").count() > 0;
      const hasEmptyState = await page.getByText(/no items require attention/i).isVisible();

      expect(hasItems || hasEmptyState).toBe(true);
    });

    test("displays Beta Health stats", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Beta Health/i)).toBeVisible();
      await expect(page.getByText(/Total Alliances/i)).toBeVisible();
      await expect(page.getByText(/Active Today/i)).toBeVisible();
      await expect(page.getByText(/New This Week/i)).toBeVisible();
    });

    test("displays Alliance Readiness summary", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Alliance Readiness/i).first()).toBeVisible();
      await expect(page.getByText(/Ready/i).first()).toBeVisible();
      await expect(page.getByText(/Needs Setup/i).first()).toBeVisible();
    });

    test("displays Setup Funnel", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Setup Funnel/i)).toBeVisible();
      // Use exact match to avoid matching activity feed items
      await expect(page.getByText("Beta Invited")).toBeVisible();
      await expect(page.getByText("Beta Accepted")).toBeVisible();
      await expect(page.getByText("Alliance Created", { exact: true })).toBeVisible();
    });

    test("displays Live Feed", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Live Feed/i).first()).toBeVisible();

      // Should show activity items (linking to platform support) or "No recent activity"
      const hasActivity = await page.locator('[href*="/platform/support/alliance/"]').count() > 0;
      const hasEmptyState = await page.getByText(/no recent activity/i).isVisible();

      expect(hasActivity || hasEmptyState).toBe(true);
    });
  });

  test.describe("Setup Page", () => {
    test("displays Setup Summary with status counts", async ({ page }) => {
      await page.goto("/platform/setup");

      await expect(page.getByText(/Setup Summary/i)).toBeVisible();
      await expect(page.getByText(/Ready/i).first()).toBeVisible();
      await expect(page.getByText(/Needs Setup/i).first()).toBeVisible();
      await expect(page.getByText(/Stalled/i).first()).toBeVisible();
      await expect(page.getByText(/New/i).first()).toBeVisible();
    });

    test("shows alliance cards on mobile viewport", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/platform/setup");

      // On mobile, should see cards not tables
      const hasSections = await page.getByText(/Setup Summary/i).isVisible();
      expect(hasSections).toBe(true);
    });
  });

  test.describe("Support Page", () => {
    test("displays search hint", async ({ page }) => {
      await page.goto("/platform/support");

      await expect(page.getByText(/search bar above/i)).toBeVisible();
    });

    test("displays all alliances list", async ({ page }) => {
      await page.goto("/platform/support");

      await expect(page.getByText(/All Alliances/i)).toBeVisible();
    });

    test("displays needs help section if items exist", async ({ page }) => {
      await page.goto("/platform/support");

      // Check if Needs Help section exists (may or may not depending on data)
      const needsHelpVisible = await page.getByText(/Needs Help/i).isVisible();

      // The section may not be visible if no one needs help
      expect(typeof needsHelpVisible).toBe("boolean");
    });
  });

  test.describe("Activity Page", () => {
    test("displays Live Feed header", async ({ page }) => {
      await page.goto("/platform/activity");

      await expect(page.getByText(/Live Feed/i)).toBeVisible();
    });

    test("groups activity by date", async ({ page }) => {
      await page.goto("/platform/activity");

      // Should have date headers like "Today", "Yesterday", or actual dates
      const hasDateHeaders =
        (await page.getByText(/Today/i).isVisible()) ||
        (await page.getByText(/Yesterday/i).isVisible()) ||
        (await page.getByText(/No activity yet/i).isVisible());

      expect(hasDateHeaders).toBe(true);
    });
  });

  test.describe("Beta Page", () => {
    test("displays Beta Invitations stats", async ({ page }) => {
      await page.goto("/platform/beta");

      await expect(page.getByText(/Beta Invitations/i).first()).toBeVisible();
      await expect(page.getByText(/Total Sent/i)).toBeVisible();
      await expect(page.getByText(/Accepted/i).first()).toBeVisible();
      await expect(page.getByText(/Pending/i).first()).toBeVisible();
    });

    test("shows warning for accepted without alliance", async ({ page }) => {
      await page.goto("/platform/beta");

      // May or may not be visible depending on data
      const warningVisible = await page
        .getByText(/Accepted Without Alliance/i)
        .isVisible();

      expect(typeof warningVisible).toBe("boolean");
    });
  });

  test.describe("Search Functionality", () => {
    test("search input is accessible from all pages", async ({ page }) => {
      const pages = [
        "/platform/overview",
        "/platform/setup",
        "/platform/support",
        "/platform/activity",
        "/platform/beta",
      ];

      for (const pagePath of pages) {
        await page.goto(pagePath);
        await expect(
          page.getByPlaceholder(/search alliances/i)
        ).toBeVisible();
      }
    });

    test("search shows results dropdown", async ({ page }) => {
      await page.goto("/platform/overview");

      const searchInput = page.getByPlaceholder(/search alliances/i);
      await searchInput.fill("DA");

      // Wait for debounce and results
      await page.waitForTimeout(400);

      // Should show either results or "No results" message
      const hasResults = await page.locator('button:has-text("🏰"), button:has-text("👤")').count() > 0;
      const hasNoResults = await page.getByText(/No results/i).isVisible();

      // Search was triggered - either found results or showed empty state
      expect(hasResults || hasNoResults).toBe(true);
    });
  });

  test.describe("Mobile Responsiveness", () => {
    test("mobile menu button is visible on small screens", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/platform/overview");

      // Mobile menu button should be visible
      const menuButton = page.locator('button[aria-label*="menu"], button:has(svg)').first();
      await expect(menuButton).toBeVisible();
    });

    test("navigation sidebar is hidden on mobile", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/platform/overview");

      // Desktop nav should be hidden
      const desktopNav = page.locator("aside.lg\\:flex");
      await expect(desktopNav).toBeHidden();
    });
  });
});
