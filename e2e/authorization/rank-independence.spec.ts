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
  test("founding operator creates alliance without rank requirement", async ({
    page,
    betaUser,
  }) => {
    // Login with unique beta user (retry-safe fixture)
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(betaUser.email);
    await page.getByLabel(/password/i).fill(betaUser.password);
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

    // Extract alliance ID from URL
    const url = page.url();
    const allianceIdMatch = url.match(/\/alliances\/([^/]+)\//);
    expect(allianceIdMatch).not.toBeNull();
    const allianceId = allianceIdMatch![1];

    // Verify the user received OWNER role (granted by workspace creation, not game rank)
    const { prisma } = await import("@/app/src/lib/prisma");
    const membership = await prisma.allianceMembership.findUnique({
      where: {
        allianceId_userId: {
          allianceId,
          userId: betaUser.userId,
        },
      },
      select: { role: true },
    });

    expect(membership).not.toBeNull();
    expect(membership!.role).toBe("OWNER");

    // User can access all setup tasks (UI verification)
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

  test("ADMIN role advances setup from incomplete to complete", async ({
    page,
    adminScenario,
  }) => {
    // Login as ADMIN user with isolated alliance
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(adminScenario.email);
    await page.getByLabel(/password/i).fill(adminScenario.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    const allianceId = adminScenario.allianceId;

    // 1. Navigate to setup page and verify "Configure Metrics" is incomplete
    await page.goto(`/alliances/${allianceId}/setup`);
    await expect(page.getByRole("heading", { name: "Alliance Setup" })).toBeVisible();

    // Capture initial progress count
    const progressTextBefore = await page.locator('text=/\\d+ of \\d+ complete/').textContent();
    expect(progressTextBefore).toMatch(/0 of \d+ complete/); // Should start at 0

    // The task should be visible and incomplete (circle icon, not checkmark)
    const configureMetricsTask = page.locator("text=Configure Metrics").first();
    await expect(configureMetricsTask).toBeVisible();

    // 2. Navigate to metrics page and create a metric
    await page.goto(`/alliances/${allianceId}/metrics`);
    await expect(page.getByRole("heading", { name: /metrics library/i })).toBeVisible();

    // Click "+ Create Metric" button and wait for form
    await page.getByRole("button", { name: /create metric/i }).first().click();
    await page.waitForSelector('input[name="name"]', { state: 'visible' });

    // Fill in the metric form
    const metricName = `E2E Admin Metric ${Date.now()}`;
    await page.fill('input[name="name"]', metricName);
    await page.fill('textarea[name="description"]', "Metric created by ADMIN to verify setup progression");

    // Submit
    await page.getByRole("button", { name: /create/i }).last().click();

    // Verify the metric was created
    await expect(page.getByText(metricName)).toBeVisible();

    // 3. Return to setup page and verify task transitioned from incomplete to complete
    await page.goto(`/alliances/${allianceId}/setup`);
    
    // Verify progress count increased
    const progressTextAfter = await page.locator('text=/\\d+ of \\d+ complete/').textContent();
    expect(progressTextAfter).not.toBe(progressTextBefore);
    expect(progressTextAfter).toMatch(/[1-9]\d* of \d+ complete/); // At least 1 complete

    // Verify the task now shows with muted styling (completed state)
    const completedTask = page.locator("text=Configure Metrics").first();
    await expect(completedTask).toBeVisible();
    await expect(completedTask).toHaveClass(/text-text-muted/); // Completed tasks are muted

    // 4. Negative assertion: ADMIN cannot manage leadership
    // Navigate to invitations page (ADMIN has canInviteCollaborators)
    await page.goto(`/alliances/${allianceId}/settings/invitations`);
    await expect(page.getByRole("heading", { name: /leadership team/i })).toBeVisible();

    // ADMIN can see the page but not role-management UI (OWNER-only)
    // Note: This is placeholder for future role management UI
    // Current test proves ADMIN can access invitation page but would not see
    // role-change controls when they exist
  });

  test("LEADER role advances period setup from incomplete to complete", async ({
    page,
    leaderScenario,
  }) => {
    // Login as LEADER user with isolated alliance
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(leaderScenario.email);
    await page.getByLabel(/password/i).fill(leaderScenario.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances)/);

    const allianceId = leaderScenario.allianceId;

    // 1. Navigate to setup page and verify "Create Evaluation Period" is incomplete
    await page.goto(`/alliances/${allianceId}/setup`);
    await expect(page.getByRole("heading", { name: "Alliance Setup" })).toBeVisible();

    // Capture initial progress count
    const progressTextBefore = await page.locator('text=/\\d+ of \\d+ complete/').textContent();
    expect(progressTextBefore).toMatch(/0 of \d+ complete/); // Should start at 0

    // The task should be visible and incomplete
    const createPeriodTask = page.locator("text=Create Evaluation Period").first();
    await expect(createPeriodTask).toBeVisible();

    // 2. Navigate to periods page and create a period
    await page.goto(`/alliances/${allianceId}/periods`);
    await expect(page.getByRole("heading", { name: "Evaluation Periods", exact: true })).toBeVisible();

    // Click "+ Create Period" button and wait for form
    await page.getByRole("button", { name: /create period/i }).first().click();
    await page.waitForSelector('input[name="name"]', { state: 'visible' });

    // Fill in the period form
    const periodName = `E2E Leader Period ${Date.now()}`;
    await page.fill('input[name="name"]', periodName);

    // Dates are optional - leave empty
    // Submit
    await page.getByRole("button", { name: /create/i }).last().click();

    // Verify the period was created
    await expect(page.getByText(periodName)).toBeVisible();

    // 3. Return to setup page and verify task transitioned from incomplete to complete
    await page.goto(`/alliances/${allianceId}/setup`);

    // Verify progress count increased
    const progressTextAfter = await page.locator('text=/\\d+ of \\d+ complete/').textContent();
    expect(progressTextAfter).not.toBe(progressTextBefore);
    expect(progressTextAfter).toMatch(/[1-9]\d* of \d+ complete/); // At least 1 complete

    // Verify the task now shows with muted styling (completed state)
    const completedTask = page.locator("text=Create Evaluation Period").first();
    await expect(completedTask).toBeVisible();
    await expect(completedTask).toHaveClass(/text-text-muted/); // Completed tasks are muted

    // 4. LEADER can configure metrics; this is an ACC role permission,
    // still independent of any in-game roster rank.
    await page.goto(`/alliances/${allianceId}/metrics`);
    await expect(page.getByRole("heading", { name: /metrics library/i })).toBeVisible();

    const createMetricButton = page.getByRole("button", { name: /^\+ create metric$/i });
    await expect(createMetricButton).toBeVisible();
  });

  test("member roster role field is descriptive only, not authorization", async ({ page, adminScenario }) => {
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(adminScenario.email);
    await page.getByLabel(/password/i).fill(adminScenario.password);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/alliances/);

    // Navigate to add member page
    await page.goto(`/alliances/${adminScenario.allianceId}/members/new`);

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
