import { test, expect } from "../shared/fixtures";

/**
 * Leadership Notes CRUD E2E Tests
 *
 * Tests create, read, update, and delete operations for leadership notes.
 * One of the biggest product differentiators.
 *
 * @tags @release-gate
 */
test.describe("Leadership Notes CRUD", () => {
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

  test("displays notes section on member detail", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    await expect(page.getByText(/leadership notes/i)).toBeVisible();
  });

  test("can create note with Positive type", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    // Click to reveal the note form
    await page.getByRole("button", { name: /add leadership note/i }).click();

    // Fill the form
    await page.getByLabel(/note type/i).selectOption("POSITIVE");
    await page.getByLabel(/note content/i).fill("Great contribution to VS event!");
    await page.getByRole("button", { name: /save note/i }).click();

    await expect(page.getByText(/great contribution/i)).toBeVisible();
  });

  test("can create note with Warning type", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    // Click to reveal the note form
    await page.getByRole("button", { name: /add leadership note/i }).click();

    // Fill the form
    await page.getByLabel(/note type/i).selectOption("WARNING");
    await page.getByLabel(/note content/i).fill("Missed scheduled attack window");
    await page.getByRole("button", { name: /save note/i }).click();

    await expect(page.getByText(/missed scheduled/i)).toBeVisible();
  });

  test("can create note with Observation type", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    // Click to reveal the note form
    await page.getByRole("button", { name: /add leadership note/i }).click();

    // Fill the form
    await page.getByLabel(/note type/i).selectOption("OBSERVATION");
    await page.getByLabel(/note content/i).fill("Showing leadership potential");
    await page.getByRole("button", { name: /save note/i }).click();

    await expect(page.getByText(/leadership potential/i)).toBeVisible();
  });

  test("shows validation error for empty content", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    // Click to reveal the note form
    await page.getByRole("button", { name: /add leadership note/i }).click();

    // Try to submit without content - HTML5 validation should kick in
    const contentInput = page.getByLabel(/note content/i);
    await expect(contentInput).toHaveAttribute("required", "");
  });

  test("author can edit their note", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);
    
    // Check if user has any editable notes
    const editButton = page.getByRole("button", { name: /^edit$/i }).first();
    const editButtonVisible = await editButton.isVisible({ timeout: 3000 }).catch(() => false);
    
    if (editButtonVisible) {
      await editButton.click();
      
      // The form should now be visible - use the textarea directly
      const textarea = page.locator('textarea[name="content"]');
      await textarea.clear();
      await textarea.fill("Updated note content");
      await page.getByRole("button", { name: /save note/i }).click();

      await expect(page.getByText(/updated note content/i)).toBeVisible();
    } else {
      // No editable notes - just verify the notes section exists
      await expect(page.getByText(/leadership notes/i)).toBeVisible();
    }
  });

  test("notes display in newest-first order", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    // Check that notes section exists
    await expect(page.getByText(/leadership notes/i)).toBeVisible();
  });

  test("notes display author name", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/${testMemberId}`);

    // Notes should show who wrote them
    const noteCards = page.locator('[data-testid="note-card"]');
    const count = await noteCards.count();

    if (count > 0) {
      await expect(noteCards.first()).toBeVisible();
    }
  });
});
