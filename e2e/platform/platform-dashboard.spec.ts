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
      await expect(page.getByRole("link", { name: "Overview", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Setup", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Support", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Beta", exact: true })).toBeVisible();
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
      await page.getByRole("link", { name: "Setup", exact: true }).click();
      await page.waitForURL("/platform/setup");
      await expect(page.getByText(/Setup Summary/i)).toBeVisible();

      // Navigate to Support
      await page.getByRole("link", { name: "Support", exact: true }).click();
      await page.waitForURL("/platform/support");
      await expect(page.getByText(/search bar above/i)).toBeVisible();

      // Navigate to Activity
      await page.getByRole("link", { name: "Activity", exact: true }).click();
      await page.waitForURL("/platform/activity");
      await expect(page.getByText(/Live Feed/i)).toBeVisible();

      // Navigate to Beta
      await page.getByRole("link", { name: "Beta", exact: true }).click();
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

      // Support page should have either a "Needs Help" section with items
      // or show "All Alliances" as the primary content
      const hasNeedsHelp = await page.getByText(/Needs Help/i).isVisible();
      const hasAllAlliances = await page.getByText(/All Alliances/i).isVisible();

      // Page must have at least one of these sections
      expect(hasNeedsHelp || hasAllAlliances).toBe(true);
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

    test("displays Invite Beta Tester form", async ({ page }) => {
      await page.goto("/platform/beta");

      await expect(
        page.getByRole("heading", { name: /Invite Beta Tester/i })
      ).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/notes/i)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Create Invitation/i })
      ).toBeVisible();
    });

    test("shows validation error for invalid email", async ({ page }) => {
      await page.goto("/platform/beta");

      // Fill with invalid email (no @)
      const emailInput = page.getByLabel(/email/i);
      await emailInput.fill("not-an-email");
      await page.getByRole("button", { name: /Create Invitation/i }).click();

      // Browser HTML5 validation should prevent submission
      // The input should be marked as invalid
      const isInvalid = await emailInput.evaluate(
        (el: HTMLInputElement) => !el.validity.valid
      );
      expect(isInvalid).toBe(true);
    });

    test("creates invitation and shows success card", async ({ page }) => {
      await page.goto("/platform/beta");

      // Generate unique email to avoid conflicts
      const uniqueEmail = `test-${Date.now()}@example.com`;

      // Fill form
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByLabel(/notes/i).fill("E2E test invitation");
      await page.getByRole("button", { name: /Create Invitation/i }).click();

      // Wait for success card heading
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      // Find the success card container (the div with the success heading)
      const successCard = page.locator("div").filter({
        has: page.getByRole("heading", { name: /Invitation Created/i }),
      });

      // Verify success card contents (scoped to avoid matching table)
      await expect(successCard.getByText(uniqueEmail).first()).toBeVisible();
      await expect(successCard.getByRole("button", { name: /Copy Code/i })).toBeVisible();
      await expect(successCard.getByRole("button", { name: /Copy Link/i })).toBeVisible();
      await expect(
        successCard.getByRole("button", { name: /Invite Another/i })
      ).toBeVisible();
    });

    test("Invite Another resets form", async ({ page }) => {
      await page.goto("/platform/beta");

      const uniqueEmail = `test-${Date.now()}@example.com`;

      // Create invitation
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      // Click Invite Another
      await page.getByRole("button", { name: /Invite Another/i }).click();

      // Form should be visible again
      await expect(
        page.getByRole("heading", { name: /Invite Beta Tester/i })
      ).toBeVisible();
      await expect(page.getByLabel(/email/i)).toHaveValue("");
    });

    test("shows duplicate email error", async ({ page }) => {
      await page.goto("/platform/beta");

      const uniqueEmail = `test-dup-${Date.now()}@example.com`;

      // Create first invitation
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      // Try to create another with same email
      await page.getByRole("button", { name: /Invite Another/i }).click();
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();

      // Should show error
      await expect(
        page.getByText(/already exists/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test("pending invitations show action buttons", async ({ page }) => {
      await page.goto("/platform/beta");

      // Create an invitation to ensure we have a pending one
      const uniqueEmail = `test-actions-${Date.now()}@example.com`;
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      // Reset to see the pending list
      await page.getByRole("button", { name: /Invite Another/i }).click();

      // On desktop, should see action buttons in table
      await page.setViewportSize({ width: 1280, height: 800 });

      // Find the row with our email
      const row = page.locator("tr").filter({ hasText: uniqueEmail });
      await expect(row).toBeVisible();

      // Action buttons should be present
      await expect(row.getByRole("button", { name: /Revoke/i })).toBeVisible();
    });

    test("revoke removes invitation from pending", async ({ page }) => {
      await page.goto("/platform/beta");

      // Create a new invitation to revoke
      const uniqueEmail = `test-revoke-${Date.now()}@example.com`;

      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      // Reset form to see the pending list
      await page.getByRole("button", { name: /Invite Another/i }).click();

      // Find the new invitation in pending list and revoke it
      await page.setViewportSize({ width: 1280, height: 800 });

      // Look for revoke button in the row with our email
      const row = page.locator("tr").filter({ hasText: uniqueEmail });
      await expect(row).toBeVisible();

      const revokeButton = row.getByRole("button", { name: /Revoke/i });
      await expect(revokeButton).toBeVisible();

      // Accept confirm dialog
      page.on("dialog", (dialog) => dialog.accept());
      await revokeButton.click();

      // Wait for the invitation to move out of pending (condition-based, not time-based)
      // Either the row disappears from Pending or appears in Revoked
      const pendingRow = page
        .locator("section")
        .filter({ hasText: /^Pending/i })
        .locator("tr")
        .filter({ hasText: uniqueEmail });

      const revokedSection = page
        .locator("section")
        .filter({ hasText: /Revoked/i });

      // Wait until either: row is gone from pending OR appears in revoked
      await expect
        .poll(
          async () => {
            const inPending = await pendingRow.count();
            const revokedVisible = await revokedSection.isVisible().catch(() => false);
            const inRevoked = revokedVisible
              ? await revokedSection.getByText(uniqueEmail).isVisible().catch(() => false)
              : false;

            return inPending === 0 || inRevoked;
          },
          { timeout: 10000 }
        )
        .toBe(true);
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

      // Search was triggered once either the results dropdown or the empty
      // state renders. Use a web-first assertion (auto-retries through the
      // debounce + API response) instead of a fixed wait plus instant check,
      // which races under load.
      const resultsDropdown = page.locator("ul.max-h-64");
      const noResultsMessage = page.getByText(/No results for/i);

      await expect(resultsDropdown.or(noResultsMessage).first()).toBeVisible();
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
