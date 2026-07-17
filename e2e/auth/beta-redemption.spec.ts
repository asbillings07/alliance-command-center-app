import { test, expect } from "../shared/fixtures";

/**
 * Beta Redemption E2E Tests
 *
 * Tests the beta invitation redemption flow.
 * Users receive a 6-digit code to join the beta program.
 *
 * @tags @release-gate
 */
test.describe("Beta Redemption", () => {
  test("displays beta code entry form", async ({ page }) => {
    await page.goto("/redeem");

    await expect(
      page.getByRole("heading", { name: /beta access/i })
    ).toBeVisible();
    await expect(page.getByText(/enter your beta code/i)).toBeVisible();
    await expect(page.getByPlaceholder("ABC-123")).toBeVisible();
    await expect(page.getByRole("button", { name: /continue/i })).toBeVisible();
  });

  test("shows error for invalid code format", async ({ page }) => {
    await page.goto("/redeem");

    // Enter code that's too short
    await page.getByPlaceholder("ABC-123").fill("ABC");
    await page.getByRole("button", { name: /continue/i }).click();

    // Should show validation error
    await expect(page.getByText(/6 characters|invalid/i)).toBeVisible();
  });

  test("shows error for non-existent code", async ({ page }) => {
    await page.goto("/redeem");

    await page.getByPlaceholder("ABC-123").fill("XXXXXX");
    await page.getByRole("button", { name: /continue/i }).click();

    // Should show error for invalid code
    await expect(page.getByText(/invalid|not found|expired/i)).toBeVisible();
  });

  test("valid code redirects to redemption page", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_CODE,
      "TEST_BETA_CODE required for redemption test"
    );

    await page.goto("/redeem");

    await page.getByPlaceholder("ABC-123").fill(process.env.TEST_BETA_CODE!);
    await page.getByRole("button", { name: /continue/i }).click();

    // Should redirect to token-based redemption page
    await page.waitForURL(/\/redeem\/.+/);
    await expect(page.getByText(/create account|sign in/i)).toBeVisible();
  });

  test("redemption page shows registration and login options", async ({
    page,
  }) => {
    test.skip(
      !process.env.TEST_BETA_TOKEN,
      "TEST_BETA_TOKEN required for redemption page test"
    );

    await page.goto(`/redeem/${process.env.TEST_BETA_TOKEN}`);

    // Should show options for new and existing users
    await expect(
      page.getByRole("link", { name: /create account/i })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /sign in/i })).toBeVisible();
  });

  test("cannot redeem already-used code", async ({ page }) => {
    test.skip(
      !process.env.TEST_USED_BETA_CODE,
      "TEST_USED_BETA_CODE required for used code test"
    );

    await page.goto("/redeem");

    await page
      .getByPlaceholder("ABC-123")
      .fill(process.env.TEST_USED_BETA_CODE!);
    await page.getByRole("button", { name: /continue/i }).click();

    // Should show error for already used code
    await expect(page.getByText(/already used|accepted/i)).toBeVisible();
  });

  test("cannot redeem expired code", async ({ page }) => {
    test.skip(
      !process.env.TEST_EXPIRED_BETA_CODE,
      "TEST_EXPIRED_BETA_CODE required for expired code test"
    );

    await page.goto("/redeem");

    await page
      .getByPlaceholder("ABC-123")
      .fill(process.env.TEST_EXPIRED_BETA_CODE!);
    await page.getByRole("button", { name: /continue/i }).click();

    // Should show error for expired code
    await expect(page.getByText(/expired/i)).toBeVisible();
  });

  test("cannot redeem revoked code", async ({ page }) => {
    test.skip(
      !process.env.TEST_REVOKED_BETA_CODE,
      "TEST_REVOKED_BETA_CODE required for revoked code test"
    );

    await page.goto("/redeem");

    await page
      .getByPlaceholder("ABC-123")
      .fill(process.env.TEST_REVOKED_BETA_CODE!);
    await page.getByRole("button", { name: /continue/i }).click();

    // Should show error for revoked code
    await expect(page.getByText(/revoked/i)).toBeVisible();
  });

  test("code input is case insensitive", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_CODE,
      "TEST_BETA_CODE required for case test"
    );

    await page.goto("/redeem");

    // Enter code in lowercase
    await page
      .getByPlaceholder("ABC-123")
      .fill(process.env.TEST_BETA_CODE!.toLowerCase());
    await page.getByRole("button", { name: /continue/i }).click();

    // Should still work (codes are case-insensitive)
    await page.waitForURL(/\/redeem\/.+/);
  });

  test("code input has max length", async ({ page }) => {
    await page.goto("/redeem");

    const input = page.getByPlaceholder("ABC-123");
    await input.fill("ABCDEFGHIJK"); // More than 7 chars

    // Should be limited to 7 characters (ABC-123 format)
    const value = await input.inputValue();
    expect(value.length).toBeLessThanOrEqual(7);
  });

  test("shows link to sign in for existing users", async ({
    page,
  }) => {
    await page.goto("/redeem");

    // Should show sign in link for existing users
    await expect(
      page.getByRole("link", { name: /sign in/i })
    ).toBeVisible();
  });
});
