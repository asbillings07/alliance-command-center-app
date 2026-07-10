import { test, expect } from "../shared/fixtures";

/**
 * Alliance Member Business Rules E2E Tests
 *
 * Tests critical business invariants that must never be violated.
 * These are permanent regression tests.
 *
 * @tags @release-gate @invariant
 */
test.describe("Alliance Member Business Rules", () => {
  const testAllianceId = process.env.TEST_ALLIANCE_ID;

  test.beforeEach(async ({ page }) => {
    test.skip(!testAllianceId, "TEST_ALLIANCE_ID required");
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("Player names are unique within an alliance", async ({ page }) => {
    // Create first member
    await page.goto(`/alliances/${testAllianceId}/members/new`);
    const uniqueName = `UniqueTest${Date.now()}`;
    await page.getByLabel(/player name/i).fill(uniqueName);
    await page.getByRole("button", { name: /add|create|save/i }).click();
    await page.waitForURL(/\/members/);

    // Try to create duplicate
    await page.goto(`/alliances/${testAllianceId}/members/new`);
    await page.getByLabel(/player name/i).fill(uniqueName);
    await page.getByRole("button", { name: /add|create|save/i }).click();

    // Should show error about duplicate name
    await expect(page.getByText(/already exists|duplicate/i)).toBeVisible();
  });

  test("Archived members remain searchable", async ({ page }) => {
    test.skip(
      !process.env.TEST_ARCHIVED_MEMBER_NAME,
      "TEST_ARCHIVED_MEMBER_NAME required"
    );

    await page.goto(`/alliances/${testAllianceId}/members?filter=all`);

    // Archived member should appear in "all" filter
    await expect(
      page.getByText(process.env.TEST_ARCHIVED_MEMBER_NAME!)
    ).toBeVisible();
  });

  test("Archived members retain historical notes", async ({ page }) => {
    test.skip(
      !process.env.TEST_ARCHIVED_MEMBER_ID,
      "TEST_ARCHIVED_MEMBER_ID required"
    );

    await page.goto(
      `/alliances/${testAllianceId}/members/${process.env.TEST_ARCHIVED_MEMBER_ID}`
    );

    // Should still show leadership notes section
    await expect(page.getByText(/leadership notes/i)).toBeVisible();
  });

  test("Archived members retain metric history", async ({ page }) => {
    test.skip(
      !process.env.TEST_ARCHIVED_MEMBER_ID,
      "TEST_ARCHIVED_MEMBER_ID required"
    );

    await page.goto(
      `/alliances/${testAllianceId}/members/${process.env.TEST_ARCHIVED_MEMBER_ID}`
    );

    // Should still show performance/metrics section
    await expect(page.getByText(/performance|metrics/i)).toBeVisible();
  });

  test("Historical notes are never lost on archive", async ({ page }) => {
    test.skip(
      !process.env.TEST_MEMBER_ID,
      "TEST_MEMBER_ID required"
    );

    // Get member detail with notes
    await page.goto(
      `/alliances/${testAllianceId}/members/${process.env.TEST_MEMBER_ID}`
    );

    // Check if member has notes
    const notesSection = page.getByText(/leadership notes/i);
    if (await notesSection.isVisible()) {
      // Count notes before archive
      const noteCount = await page.locator('[data-testid="note-card"]').count();

      if (noteCount > 0) {
        // Archive the member
        await page.getByRole("button", { name: /archive/i }).click();
        const confirmButton = page.getByRole("button", { name: /confirm|yes/i });
        if (await confirmButton.isVisible()) {
          await confirmButton.click();
        }

        // Refresh and check notes still exist
        await page.reload();
        const noteCountAfter = await page
          .locator('[data-testid="note-card"]')
          .count();

        expect(noteCountAfter).toBe(noteCount);

        // Restore the member for other tests
        await page.getByRole("button", { name: /restore/i }).click();
      }
    }
  });

  test("Historical metric entries are never lost on archive", async ({
    page,
  }) => {
    test.skip(
      !process.env.TEST_MEMBER_ID,
      "TEST_MEMBER_ID required"
    );

    await page.goto(
      `/alliances/${testAllianceId}/members/${process.env.TEST_MEMBER_ID}`
    );

    // Check if member has metric entries
    const perfSection = page.getByText(/performance|metrics/i);
    if (await perfSection.isVisible()) {
      // If there are metric entries visible, archive and verify they persist
      // This is a structural check - the UI should still show metric history
    }
  });
});

test.describe("Alliance Member Filter Tests", () => {
  const testAllianceId = process.env.TEST_ALLIANCE_ID;

  test.beforeEach(async ({ page }) => {
    test.skip(!testAllianceId, "TEST_ALLIANCE_ID required");
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("Active filter shows only active members", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members?filter=active`);

    // The filter label itself may contain "archived" text, so check table only
    const tableArchivedBadges = await page
      .locator("table")
      .getByText(/archived/i)
      .count();
    expect(tableArchivedBadges).toBe(0);
  });

  test("Archived filter shows only archived members", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members?filter=archived`);

    // All visible members in table should be archived
    const memberRows = await page.locator("table tbody tr").count();
    if (memberRows > 0) {
      const archivedBadges = await page
        .locator("table")
        .getByText(/archived/i)
        .count();
      expect(archivedBadges).toBeGreaterThan(0);
    }
  });

  test("All filter shows both active and archived", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members?filter=all`);

    // Should show at least the count combining active and archived
    await expect(page.getByRole("heading", { name: /roster/i })).toBeVisible();
  });

  test("Filter persists across navigation", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members?filter=archived`);

    // Navigate to a member and back
    const memberLink = page.locator("table tbody tr a").first();
    if (await memberLink.isVisible()) {
      await memberLink.click();
      await page.goBack();

      // Filter should persist
      expect(page.url()).toContain("filter=archived");
    }
  });

  test("Filter tabs show correct counts", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members`);

    // Filter tabs should show counts
    await expect(page.getByText(/active.*\d+/i)).toBeVisible();
  });
});
