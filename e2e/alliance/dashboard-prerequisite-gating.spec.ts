import { test, expect } from "../shared/fixtures";

test.describe("Dashboard prerequisite gating (#200 PR 3)", () => {
  test("brand-new alliance dashboard hides Record and Import until prerequisites exist", async ({
    page,
    betaUser,
  }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(betaUser.email);
    await page.getByLabel(/password/i).fill(betaUser.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/create-alliance/);

    const allianceName = `Dashboard Gate ${Date.now()}`;
    await page.getByLabel(/alliance name/i).fill(allianceName);
    await page.getByRole("button", { name: /create/i }).click();
    await page.waitForURL(/\/alliances\/.*\/setup/);

    const allianceId = page.url().match(/\/alliances\/([^/]+)\/setup/)?.[1];
    expect(allianceId).toBeTruthy();

    await page.goto(`/alliances/${allianceId}`);
    await expect(page.getByText("Evaluation Results")).toBeVisible();
    await expect(page.getByText("No evaluation periods yet")).toBeVisible();
    await expect(page.getByRole("link", { name: "Record Now" })).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Import Evaluation Results" }),
    ).toHaveCount(0);
  });
});
