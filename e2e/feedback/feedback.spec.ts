import { test, expect } from "../shared/fixtures";

/**
 * Beta Feedback widget E2E.
 *
 * Verifies an authenticated user can open the global feedback widget, submit a
 * message, and see the confirmation. Email delivery uses the LoggingTransport
 * in the test environment, so no external calls are made.
 *
 * @tags @release-gate
 */
test.describe("Beta Feedback", () => {
  test("submits feedback from an authenticated page", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "TEST_OWNER_EMAIL and TEST_OWNER_PASSWORD required"
    );

    // Sign in and land on an authenticated surface (the widget mounts in the
    // alliances + platform layouts).
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    if (process.env.TEST_ALLIANCE_ID) {
      await page.goto(`/alliances/${process.env.TEST_ALLIANCE_ID}`);
    }

    // Open the widget.
    await page.getByRole("button", { name: /send feedback/i }).click();

    // Fill and submit.
    await page.getByLabel(/message/i).fill("E2E: import preview looked off.");
    await page.getByRole("button", { name: /send feedback/i }).click();

    // Confirmation appears.
    await expect(
      page.getByText(/sent directly to the team/i)
    ).toBeVisible();
  });

  test("does not show the feedback widget when signed out", async ({ page }) => {
    await page.goto("/login");
    await expect(
      page.getByRole("button", { name: /send feedback/i })
    ).toHaveCount(0);
  });
});
