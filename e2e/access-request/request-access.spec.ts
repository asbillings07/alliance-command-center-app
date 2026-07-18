import { test, expect } from "../shared/fixtures";

/**
 * Access Request E2E Tests
 *
 * The access-request page is the public "how do I get in?" entry point for the
 * invite-only beta. It is intentionally separate from the invitation flow: it
 * only captures interest.
 *
 * @tags @release-gate
 */
test.describe("Request Beta Access", () => {
  test("is reachable from the home page", async ({ page }) => {
    await page.goto("/");

    await page.getByRole("link", { name: /request beta access/i }).click();

    await expect(page).toHaveURL(/\/request-access/);
    await expect(
      page.getByRole("heading", { name: /request beta access/i })
    ).toBeVisible();
  });

  test("displays the request form fields", async ({ page }) => {
    await page.goto("/request-access");

    await expect(page.getByLabel(/^name$/i)).toBeVisible();
    await expect(page.getByLabel(/^email$/i)).toBeVisible();
    await expect(page.getByLabel(/alliance name/i)).toBeVisible();
    await expect(page.getByLabel(/why are you interested/i)).toBeVisible();
    await expect(
      page.getByRole("button", { name: /request access/i })
    ).toBeVisible();
  });

  test("submitting a request shows a confirmation", async ({ page }) => {
    await page.goto("/request-access");

    await page.getByLabel(/^name$/i).fill("Beta Hopeful");
    await page
      .getByLabel(/^email$/i)
      .fill(`beta-hopeful+${Date.now()}@example.com`);
    await page.getByLabel(/alliance name/i).fill("Test Alliance");
    await page
      .getByLabel(/why are you interested/i)
      .fill("We want better leadership tooling.");

    await page.getByRole("button", { name: /request access/i }).click();

    await expect(page.getByText(/received your request/i)).toBeVisible();
  });

  test("a request with only the required fields succeeds", async ({ page }) => {
    await page.goto("/request-access");

    await page.getByLabel(/^name$/i).fill("Minimal Applicant");
    await page
      .getByLabel(/^email$/i)
      .fill(`minimal+${Date.now()}@example.com`);

    await page.getByRole("button", { name: /request access/i }).click();

    await expect(page.getByText(/received your request/i)).toBeVisible();
  });
});
