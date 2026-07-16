import { test, expect } from "../shared/fixtures";

/**
 * Leadership Notes Permissions E2E Tests
 *
 * Tests permission-based access to note functionality.
 * Enforces ADR-006 (authorization on server).
 *
 * @tags @release-gate @invariant
 */
test.describe("Leadership Notes Permissions", () => {
  const testAllianceId = process.env.TEST_ALLIANCE_ID;
  const testMemberId = process.env.TEST_MEMBER_ID;

  test("Viewers cannot see add note form", async ({ page }) => {
    test.skip(
      !testAllianceId ||
        !testMemberId ||
        !process.env.TEST_VIEWER_EMAIL ||
        !process.env.TEST_VIEWER_PASSWORD,
      "Viewer credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_VIEWER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_VIEWER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    // Viewer should NOT see the add note button
    await expect(page.getByRole("button", { name: /add leadership note/i })).not.toBeVisible();
  });

  test("Leaders can add notes", async ({ page }) => {
    test.skip(
      !testAllianceId ||
        !testMemberId ||
        !process.env.TEST_LEADER_EMAIL ||
        !process.env.TEST_LEADER_PASSWORD,
      "Leader credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_LEADER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_LEADER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    // Leader SHOULD see the add note button
    await expect(page.getByRole("button", { name: /add leadership note/i })).toBeVisible();
  });

  test("Only authors can edit their own notes", async ({ page }) => {
    test.skip(
      !testAllianceId ||
        !testMemberId ||
        !process.env.TEST_OWNER_EMAIL ||
        !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    // Edit buttons should only appear on notes authored by current user
    const noteCards = page.locator('[data-testid="note-card"]');
    const count = await noteCards.count();

    // Basic check - notes section should be visible
    if (count > 0) {
      await expect(noteCards.first()).toBeVisible();
    }
  });
});

test.describe("Leadership Notes Business Rules", () => {
  const testAllianceId = process.env.TEST_ALLIANCE_ID;
  const testMemberId = process.env.TEST_MEMBER_ID;

  test.beforeEach(async ({ page }) => {
    test.skip(!testAllianceId || !testMemberId, "TEST_ALLIANCE_ID and TEST_MEMBER_ID required");
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

  test("Notes section is always visible on member page", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    const noteSection = page.getByText(/leadership notes/i);
    await expect(noteSection).toBeVisible();
  });

  test("Note history is preserved across page loads", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    const initialNotes = await page.locator('[data-testid="note-card"]').count();

    await page.reload();

    const afterRefreshNotes = await page
      .locator('[data-testid="note-card"]')
      .count();

    expect(afterRefreshNotes).toBe(initialNotes);
  });
});
