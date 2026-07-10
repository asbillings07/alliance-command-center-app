import { test, expect } from "../shared/fixtures";

/**
 * Alliance Invitation E2E Tests
 *
 * Tests the alliance invitation acceptance flow.
 * Users receive invitations to join existing alliances with specific roles.
 *
 * @tags @release-gate
 */
test.describe("Alliance Invitation", () => {
  test("displays invitation code entry form", async ({ page }) => {
    await page.goto("/invite");

    await expect(
      page.getByRole("heading", { name: /join|invitation/i })
    ).toBeVisible();
    await expect(page.getByPlaceholder(/abc.*123/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /continue/i })).toBeVisible();
  });

  test("shows error for invalid code format", async ({ page }) => {
    await page.goto("/invite");

    await page.getByPlaceholder(/abc.*123/i).fill("XYZ");
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByText(/6 characters|invalid/i)).toBeVisible();
  });

  test("shows error for non-existent code", async ({ page }) => {
    await page.goto("/invite");

    await page.getByPlaceholder(/abc.*123/i).fill("XXXXXX");
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByText(/invalid|not found|expired/i)).toBeVisible();
  });

  test("valid code redirects to invitation details", async ({ page }) => {
    test.skip(
      !process.env.TEST_INVITE_CODE,
      "TEST_INVITE_CODE required for invitation test"
    );

    await page.goto("/invite");

    await page.getByPlaceholder(/abc.*123/i).fill(process.env.TEST_INVITE_CODE!);
    await page.getByRole("button", { name: /continue/i }).click();

    await page.waitForURL(/\/invite\/.+/);
    await expect(page.getByText(/invited/i)).toBeVisible();
  });

  test("invitation page shows alliance and role details", async ({ page }) => {
    test.skip(
      !process.env.TEST_INVITE_TOKEN,
      "TEST_INVITE_TOKEN required for invitation page test"
    );

    await page.goto(`/invite/${process.env.TEST_INVITE_TOKEN}`);

    // Should show invitation details
    await expect(page.getByText(/invited/i)).toBeVisible();
    // Should show alliance name and role
    await expect(
      page.getByText(/admin|leader|viewer/i)
    ).toBeVisible();
  });

  test("invitation page shows registration and login options", async ({
    page,
  }) => {
    test.skip(
      !process.env.TEST_INVITE_TOKEN,
      "TEST_INVITE_TOKEN required for invitation page test"
    );

    await page.goto(`/invite/${process.env.TEST_INVITE_TOKEN}`);

    await expect(
      page.getByRole("link", { name: /create account/i })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("cannot accept already-used invitation", async ({ page }) => {
    test.skip(
      !process.env.TEST_USED_INVITE_CODE,
      "TEST_USED_INVITE_CODE required for used invitation test"
    );

    await page.goto("/invite");

    await page
      .getByPlaceholder(/abc.*123/i)
      .fill(process.env.TEST_USED_INVITE_CODE!);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByText(/already|accepted|used/i)).toBeVisible();
  });

  test("cannot accept expired invitation", async ({ page }) => {
    test.skip(
      !process.env.TEST_EXPIRED_INVITE_CODE,
      "TEST_EXPIRED_INVITE_CODE required for expired invitation test"
    );

    await page.goto("/invite");

    await page
      .getByPlaceholder(/abc.*123/i)
      .fill(process.env.TEST_EXPIRED_INVITE_CODE!);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByText(/expired/i)).toBeVisible();
  });

  test("cannot accept cancelled invitation", async ({ page }) => {
    test.skip(
      !process.env.TEST_CANCELLED_INVITE_CODE,
      "TEST_CANCELLED_INVITE_CODE required for cancelled invitation test"
    );

    await page.goto("/invite");

    await page
      .getByPlaceholder(/abc.*123/i)
      .fill(process.env.TEST_CANCELLED_INVITE_CODE!);
    await page.getByRole("button", { name: /continue/i }).click();

    await expect(page.getByText(/cancelled|invalid/i)).toBeVisible();
  });

  test("logged in user can accept invitation directly", async ({ page }) => {
    test.skip(
      !process.env.TEST_INVITE_TOKEN ||
        !process.env.TEST_OWNER_EMAIL ||
        !process.env.TEST_OWNER_PASSWORD,
      "TEST_INVITE_TOKEN, TEST_OWNER_EMAIL, TEST_OWNER_PASSWORD required"
    );

    // First log in
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    // Then visit invitation
    await page.goto(`/invite/${process.env.TEST_INVITE_TOKEN}`);

    // Should show accept button for logged in users
    await expect(
      page.getByRole("button", { name: /accept|join/i })
    ).toBeVisible();
  });

  test("code input has max length", async ({ page }) => {
    await page.goto("/invite");

    const input = page.getByPlaceholder(/abc.*123/i);
    await input.fill("ABCDEFGHIJK");

    const value = await input.inputValue();
    expect(value.length).toBeLessThanOrEqual(6);
  });

  test("shows link to beta for users without invitation", async ({ page }) => {
    await page.goto("/invite");

    await expect(page.getByRole("link", { name: /beta/i })).toBeVisible();
  });
});
