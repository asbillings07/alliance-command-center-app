import { test, expect } from "../shared/fixtures";

/**
 * Alliance Member CRUD E2E Tests
 *
 * Tests create, read, update, and archive operations for alliance members.
 * This is the heart of the product.
 *
 * @tags @release-gate
 */
test.describe("Alliance Member CRUD", () => {
  const testAllianceId = process.env.TEST_ALLIANCE_ID;

  test.beforeEach(async ({ page }) => {
    test.skip(!testAllianceId, "TEST_ALLIANCE_ID required");
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    // Login as owner
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);
  });

  test("displays member roster", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members`);

    await expect(page.getByRole("heading", { name: /roster/i })).toBeVisible();
  });

  test("shows Add Member button for authorized users", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members`);

    await expect(
      page.getByRole("link", { name: /add member/i })
    ).toBeVisible();
  });

  test("can create new member", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/new`);

    const memberName = `TestMember${Date.now()}`;
    await page.getByLabel(/player name/i).fill(memberName);
    await page.getByRole("button", { name: /add|create|save/i }).click();

    // Should redirect to members list or member detail
    await page.waitForURL(/\/members/);
    await expect(page.getByText(memberName)).toBeVisible();
  });

  test("shows validation error for empty name", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members/new`);

    await page.getByRole("button", { name: /add|create|save/i }).click();

    await expect(page.getByText(/name.*required/i)).toBeVisible();
  });

  test("can view member detail page", async ({ page }) => {
    await page.goto(`/alliances/${testAllianceId}/members`);

    // Click on first member in roster
    const memberLink = page.locator("table tbody tr a").first();
    if (await memberLink.isVisible()) {
      const memberName = await memberLink.textContent();
      await memberLink.click();

      await expect(
        page.getByRole("heading", { name: new RegExp(memberName || "", "i") })
      ).toBeVisible();
    }
  });

  test("can edit member", async ({ page }) => {
    test.skip(!process.env.TEST_MEMBER_ID, "TEST_MEMBER_ID required");

    await page.goto(
      `/alliances/${testAllianceId}/members/${process.env.TEST_MEMBER_ID}/edit`
    );

    const newName = `EditedMember${Date.now()}`;
    await page.getByLabel(/player name/i).fill(newName);
    await page.getByRole("button", { name: /save|update/i }).click();

    // Should redirect to member detail
    await page.waitForURL(/\/members\//);
    await expect(page.getByText(newName)).toBeVisible();
  });

  test("can archive member", async ({ page }) => {
    test.skip(!process.env.TEST_MEMBER_ID, "TEST_MEMBER_ID required");

    await page.goto(
      `/alliances/${testAllianceId}/members/${process.env.TEST_MEMBER_ID}`
    );

    await page.getByRole("button", { name: /archive/i }).click();

    // May have confirmation dialog
    const confirmButton = page.getByRole("button", { name: /confirm|yes/i });
    if (await confirmButton.isVisible()) {
      await confirmButton.click();
    }

    // Should show archived status
    await expect(page.getByText(/archived/i)).toBeVisible();
  });

  test("can restore archived member", async ({ page }) => {
    test.skip(!process.env.TEST_ARCHIVED_MEMBER_ID, "TEST_ARCHIVED_MEMBER_ID required");

    await page.goto(
      `/alliances/${testAllianceId}/members/${process.env.TEST_ARCHIVED_MEMBER_ID}`
    );

    await page.getByRole("button", { name: /restore/i }).click();

    // Should restore member
    await expect(page.getByText(/archived/i)).not.toBeVisible();
  });

  test("back link returns to roster", async ({ page }) => {
    test.skip(!process.env.TEST_MEMBER_ID, "TEST_MEMBER_ID required");

    await page.goto(
      `/alliances/${testAllianceId}/members/${process.env.TEST_MEMBER_ID}`
    );

    await page.getByRole("link", { name: /back.*roster/i }).click();

    await expect(page).toHaveURL(`/alliances/${testAllianceId}/members`);
  });

  test("breadcrumb navigation works", async ({ page }) => {
    test.skip(!process.env.TEST_MEMBER_ID, "TEST_MEMBER_ID required");

    await page.goto(
      `/alliances/${testAllianceId}/members/${process.env.TEST_MEMBER_ID}`
    );

    // Click on Members breadcrumb
    const breadcrumb = page.getByRole("link", { name: /members/i }).first();
    await breadcrumb.click();

    await expect(page).toHaveURL(`/alliances/${testAllianceId}/members`);
  });
});
