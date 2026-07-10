import { test, expect } from "../shared/fixtures";

/**
 * Tenant Isolation E2E Tests
 *
 * Tests that alliance data is properly isolated between tenants.
 * Enforces ADR-002 (multi-tenant architecture).
 *
 * @tags @release-gate @invariant
 */
test.describe("Tenant Isolation", () => {
  test("Owner A cannot see Alliance B", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL ||
        !process.env.TEST_OWNER_PASSWORD ||
        !process.env.TEST_OTHER_ALLIANCE_ID,
      "Owner credentials and other alliance ID required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    // Try to access another alliance's dashboard
    await page.goto(`/alliances/${process.env.TEST_OTHER_ALLIANCE_ID}`);

    // Should be redirected to /app or see an error
    await page.waitForURL(/\/(app|alliances)/);
    expect(page.url()).not.toContain(process.env.TEST_OTHER_ALLIANCE_ID);
  });

  test("Cannot access other alliance members via direct URL", async ({
    page,
  }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL ||
        !process.env.TEST_OWNER_PASSWORD ||
        !process.env.TEST_OTHER_ALLIANCE_ID,
      "Owner credentials and other alliance ID required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    // Try to access another alliance's members
    await page.goto(`/alliances/${process.env.TEST_OTHER_ALLIANCE_ID}/members`);

    // Should be redirected
    await page.waitForURL(/\/(app|alliances)/);
    expect(page.url()).not.toContain(process.env.TEST_OTHER_ALLIANCE_ID);
  });

  test("Cannot access other alliance metrics via direct URL", async ({
    page,
  }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL ||
        !process.env.TEST_OWNER_PASSWORD ||
        !process.env.TEST_OTHER_ALLIANCE_ID,
      "Owner credentials and other alliance ID required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${process.env.TEST_OTHER_ALLIANCE_ID}/metrics`);

    await page.waitForURL(/\/(app|alliances)/);
    expect(page.url()).not.toContain(process.env.TEST_OTHER_ALLIANCE_ID);
  });

  test("Cannot access other alliance periods via direct URL", async ({
    page,
  }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL ||
        !process.env.TEST_OWNER_PASSWORD ||
        !process.env.TEST_OTHER_ALLIANCE_ID,
      "Owner credentials and other alliance ID required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(`/alliances/${process.env.TEST_OTHER_ALLIANCE_ID}/periods`);

    await page.waitForURL(/\/(app|alliances)/);
    expect(page.url()).not.toContain(process.env.TEST_OTHER_ALLIANCE_ID);
  });

  test("Cannot access other alliance invitations via direct URL", async ({
    page,
  }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL ||
        !process.env.TEST_OWNER_PASSWORD ||
        !process.env.TEST_OTHER_ALLIANCE_ID,
      "Owner credentials and other alliance ID required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    await page.goto(
      `/alliances/${process.env.TEST_OTHER_ALLIANCE_ID}/settings/invitations`
    );

    await page.waitForURL(/\/(app|alliances)/);
    expect(page.url()).not.toContain(process.env.TEST_OTHER_ALLIANCE_ID);
  });

  test("Alliance membership required for all alliance routes", async ({
    page,
  }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL ||
        !process.env.TEST_OWNER_PASSWORD ||
        !process.env.TEST_OTHER_ALLIANCE_ID,
      "Owner credentials and other alliance ID required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    // Try various routes under another alliance
    const routes = [
      `/alliances/${process.env.TEST_OTHER_ALLIANCE_ID}`,
      `/alliances/${process.env.TEST_OTHER_ALLIANCE_ID}/members`,
      `/alliances/${process.env.TEST_OTHER_ALLIANCE_ID}/setup`,
    ];

    for (const route of routes) {
      await page.goto(route);
      await page.waitForURL(/\/(app|alliances)/);
      expect(page.url()).not.toContain(process.env.TEST_OTHER_ALLIANCE_ID);
    }
  });
});
