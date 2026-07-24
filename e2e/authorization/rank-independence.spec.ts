import { test, expect } from "../shared/fixtures";

/**
 * Rank Independence E2E Tests
 *
 * Verifies that Alliance Command Center authorization is entirely based on
 * ACC roles (OWNER, ADMIN, LEADER, VIEWER), not in-game Last War rank.
 *
 * Issue #182: Decouple ACC workspace ownership from in-game R5 rank
 *
 * @tags @release-gate
 */
test.describe("Rank Independence", () => {
  test("founding operator creates alliance without rank requirement", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_USER_EMAIL || !process.env.TEST_BETA_USER_PASSWORD,
      "TEST_BETA_USER_EMAIL and TEST_BETA_USER_PASSWORD required"
    );

    // Login with beta invitation - no rank required or consulted
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_BETA_USER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_BETA_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    // Should redirect to create alliance (no rank check occurs)
    await page.waitForURL(/\/create-alliance/);

    // Create alliance
    const allianceName = `Rank-Independent Alliance ${Date.now()}`;
    await page.getByLabel(/alliance name/i).fill(allianceName);
    await page.getByRole("button", { name: /create/i }).click();

    // Should succeed and redirect to setup
    await page.waitForURL(/\/alliances\/.*\/setup/);
    await expect(page.getByText(allianceName)).toBeVisible();

    // User should have OWNER role (granted by ACC, not game rank)
    // Verify by checking they can see owner-only setup tasks
    await expect(page.getByText(/configure metrics/i)).toBeVisible();
    await expect(page.getByText(/create.*period/i)).toBeVisible();
    await expect(page.getByText(/invite.*leadership/i)).toBeVisible();
  });

  test("setup tasks display ACC role, not game rank", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || !process.env.TEST_OWNER_PASSWORD,
      "Owner credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    const testAllianceId = process.env.TEST_ALLIANCE_ID;
    test.skip(!testAllianceId, "TEST_ALLIANCE_ID required");

    await page.goto(`/alliances/${testAllianceId}/setup`);

    // Setup page should reference ACC roles, not game ranks
    // "Founding Operator" instead of "R5 Owner"
    const pageContent = await page.textContent("body");
    
    // Should NOT mention game ranks
    expect(pageContent).not.toMatch(/\bR[45]\b/i);
    expect(pageContent).not.toMatch(/rank/i);
    
    // Should mention ACC roles or neutral terminology
    // The actual role labels are visible in task descriptions
    // We verify they're not game-rank-specific
  });

  test("ADMIN role can complete setup tasks without OWNER role", async ({ page }) => {
    test.skip(
      !process.env.TEST_ADMIN_EMAIL || !process.env.TEST_ADMIN_PASSWORD || !process.env.TEST_ALLIANCE_ID,
      "TEST_ADMIN_EMAIL, TEST_ADMIN_PASSWORD, and TEST_ALLIANCE_ID required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    const testAllianceId = process.env.TEST_ALLIANCE_ID!;

    // Navigate to metrics page (ADMIN permission: canConfigureMetrics)
    await page.goto(`/alliances/${testAllianceId}/metrics`);
    await expect(page.getByRole("heading", { name: /metrics library/i })).toBeVisible();

    // Click the "+ Create Metric" button to open the form
    await page.getByRole("button", { name: /^\+ create metric$/i }).click();

    // Fill in the metric form with unique name to avoid conflicts
    const metricName = `E2E Admin Metric ${Date.now()}`;
    await page.getByLabel(/^name$/i).fill(metricName);
    await page.getByLabel(/^description/i).fill("Metric created by ADMIN to prove non-owner can complete setup");
    
    // Type defaults to Numeric - leave as-is
    // Submit the form
    await page.getByRole("button", { name: /^create metric$/i }).click();

    // Verify the metric was created and form closed
    await expect(page.getByText(metricName)).toBeVisible();

    // This proves ADMIN can complete the "Configure Metrics" setup task
    // without OWNER role, advancing alliance-scoped setup
  });

  test("LEADER role can complete period creation without admin privileges", async ({ page }) => {
    test.skip(
      !process.env.TEST_LEADER_EMAIL || !process.env.TEST_LEADER_PASSWORD || !process.env.TEST_ALLIANCE_ID,
      "TEST_LEADER_EMAIL, TEST_LEADER_PASSWORD, and TEST_ALLIANCE_ID required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_LEADER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_LEADER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    const testAllianceId = process.env.TEST_ALLIANCE_ID!;

    // Navigate to periods page (LEADER permission: canConfigurePeriods)
    await page.goto(`/alliances/${testAllianceId}/periods`);
    await expect(page.getByRole("heading", { name: /evaluation periods/i })).toBeVisible();

    // Click the "+ Create Period" button to open the form
    await page.getByRole("button", { name: /^\+ create period$/i }).click();

    // Fill in the period form with unique name
    const periodName = `E2E Leader Period ${Date.now()}`;
    await page.getByLabel(/^name$/i).fill(periodName);
    
    // Dates are optional - leave them empty for simplicity
    // Submit the form
    await page.getByRole("button", { name: /^create period$/i }).click();

    // Verify the period was created
    await expect(page.getByText(periodName)).toBeVisible();

    // This proves LEADER can complete the "Create Evaluation Period" setup task
    // without ADMIN or OWNER privileges, advancing alliance-scoped setup
  });

  test("member roster role field is descriptive only, not authorization", async ({ page }) => {
    test.skip(
      !process.env.TEST_OWNER_EMAIL || 
      !process.env.TEST_OWNER_PASSWORD || 
      !process.env.TEST_ALLIANCE_ID,
      "Owner credentials and TEST_ALLIANCE_ID required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_OWNER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_OWNER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    const testAllianceId = process.env.TEST_ALLIANCE_ID!;

    // Navigate to add member page
    await page.goto(`/alliances/${testAllianceId}/members/new`);

    // The "role" field (in-game rank like "R4", "Officer") should be optional
    // Wait for the form to load first
    await expect(page.getByLabel(/player name/i)).toBeVisible();
    
    const roleInput = page.getByLabel(/^role$/i);
    await expect(roleInput).toBeVisible();
    
    // Verify it's optional by checking for lack of "required" attribute
    const isRequired = await roleInput.getAttribute("required");
    expect(isRequired).toBeNull();
    
    // The placeholder should show it's for game metadata, not ACC authorization
    await expect(roleInput).toHaveAttribute("placeholder", /r4|officer/i);
  });

  test("alliance creation only requires beta invitation, not rank", async ({ page }) => {
    test.skip(
      !process.env.TEST_BETA_USER_EMAIL || !process.env.TEST_BETA_USER_PASSWORD,
      "Beta user credentials required"
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_BETA_USER_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_BETA_USER_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();

    // If user has a beta invitation, they can create an alliance
    // No rank field is requested during alliance creation
    await page.waitForURL(/\/(create-alliance|alliances)/);
    
    if (page.url().includes("create-alliance")) {
      // Verify the form doesn't ask for rank
      const formContent = await page.locator("form").textContent();
      expect(formContent).not.toMatch(/rank/i);
      expect(formContent).not.toMatch(/\bR[45]\b/i);
      
      // Only alliance name should be required
      await expect(page.getByLabel(/alliance name/i)).toBeVisible();
      await expect(page.getByRole("button", { name: /create/i })).toBeVisible();
    }
  });
});
