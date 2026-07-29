import { test, expect } from "../shared/fixtures";
import { checkA11yLevelAA } from "../shared/accessibility";
import { prisma } from "@/app/src/lib/prisma";
import crypto from "crypto";

/**
 * Platform Operations Console E2E Tests
 *
 * Tests the /platform operational console functionality.
 * Organized by workflows, not data entities.
 *
 * Note: These tests require a platform admin user to be authenticated.
 */

test.describe("Platform Operations Console", () => {
  test.beforeEach(async ({ page }) => {
    // Skip if platform admin credentials not available
    test.skip(
      !process.env.TEST_PLATFORM_ADMIN_EMAIL ||
        !process.env.TEST_PLATFORM_ADMIN_PASSWORD,
      "TEST_PLATFORM_ADMIN_EMAIL and TEST_PLATFORM_ADMIN_PASSWORD required"
    );

    // Login as platform admin
    await page.goto("/login");
    await page
      .getByLabel(/email/i)
      .fill(process.env.TEST_PLATFORM_ADMIN_EMAIL!);
    await page
      .getByLabel(/password/i)
      .fill(process.env.TEST_PLATFORM_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances|platform)/);
  });

  test.describe("Layout and Navigation", () => {
    test("redirects /platform to /platform/overview", async ({ page }) => {
      await page.goto("/platform");
      await page.waitForURL("/platform/overview");
      expect(page.url()).toContain("/platform/overview");
    });

    test("displays platform header with search", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(
        page.getByRole("heading", { name: /Platform Operations/i })
      ).toBeVisible();
      await expect(
        page.getByPlaceholder(/search alliances/i)
      ).toBeVisible();
    });

    test("displays workflow navigation on desktop", async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/platform/overview");

      // Check navigation links exist
      await expect(page.getByRole("link", { name: "Overview", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Setup", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Support", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Activity", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Beta", exact: true })).toBeVisible();
    });

    test("displays platform footer", async ({ page }) => {
      await page.goto("/platform/overview");

      const footer = page.locator("footer");
      await expect(footer.getByText(/ACC v/)).toBeVisible();
      await expect(footer.getByText(/DB Connected/)).toBeVisible();
    });

    test("navigates between workflow pages", async ({ page }) => {
      await page.goto("/platform/overview");

      // Navigate to Setup
      await page.getByRole("link", { name: "Setup", exact: true }).click();
      await page.waitForURL("/platform/setup");
      await expect(page.getByText(/Setup Summary/i)).toBeVisible();

      // Navigate to Support
      await page.getByRole("link", { name: "Support", exact: true }).click();
      await page.waitForURL("/platform/support");
      await expect(page.getByText(/search bar above/i)).toBeVisible();

      // Navigate to Activity
      await page.getByRole("link", { name: "Activity", exact: true }).click();
      await page.waitForURL("/platform/activity");
      await expect(page.getByText(/Live Feed/i)).toBeVisible();

      // Navigate to Beta
      await page.getByRole("link", { name: "Beta", exact: true }).click();
      await page.waitForURL("/platform/beta");
      await expect(
        page.getByRole("heading", { name: /Beta Participants/i })
      ).toBeVisible();
    });
  });

  test.describe("Overview Page", () => {
    test("displays Action Required section", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Action Required/i).first()).toBeVisible();

      // Should show either items or "No items require attention"
      const hasItems = await page.locator(".bg-danger\\/10, .bg-warning\\/10, .bg-primary\\/10").count() > 0;
      const hasEmptyState = await page.getByText(/no items require attention/i).isVisible();

      expect(hasItems || hasEmptyState).toBe(true);
    });

    test("links Action Required beta item to filtered beta participants list", async ({
      page,
    }, testInfo) => {
      const suffix = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `e2e-expired-attention-${suffix}@example.test`;
      const now = Date.now();
      const participant = await prisma.betaParticipant.create({ data: {} });
      const invitation = await prisma.betaInvitation.create({
        data: {
          participantId: participant.id,
          email,
          code: `E2E-${suffix.slice(0, 6).toUpperCase()}`,
          token: crypto.randomUUID(),
          issuedAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
        },
      });

      try {
        await page.goto("/platform/overview");

        const betaActionLink = page.getByRole("link").filter({ hasText: email });
        await expect(betaActionLink).toBeVisible({ timeout: 10000 });
        await expect(betaActionLink).toHaveAttribute(
          "href",
          "/platform/beta?attentionReason=invitation_expired",
        );

        await betaActionLink.click();
        await page.waitForURL(/\/platform\/beta\?attentionReason=invitation_expired/);
        await expect(page.getByLabel(/^Attention$/i)).toHaveValue(
          "invitation_expired",
        );
        const participantRow = page.locator("table tbody tr").filter({ hasText: email });
        await expect(participantRow).toBeVisible();
      } finally {
        await prisma.betaInvitation.delete({ where: { id: invitation.id } });
        await prisma.betaParticipant.delete({ where: { id: participant.id } });
      }
    });

    async function seedExpiredBetaAttentionItem(
      testInfo: { retry: number },
    ): Promise<{ email: string; participantId: string; invitationId: string }> {
      const suffix = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 8)}`;
      const email = `e2e-expired-attention-${suffix}@example.test`;
      const now = Date.now();
      const participant = await prisma.betaParticipant.create({ data: {} });
      const invitation = await prisma.betaInvitation.create({
        data: {
          participantId: participant.id,
          email,
          code: `E2E-${suffix.slice(0, 6).toUpperCase()}`,
          token: crypto.randomUUID(),
          issuedAt: new Date(now - 10 * 24 * 60 * 60 * 1000),
          expiresAt: new Date(now - 2 * 24 * 60 * 60 * 1000),
        },
      });

      return {
        email,
        participantId: participant.id,
        invitationId: invitation.id,
      };
    }

    test("activates Action Required beta link via keyboard", async ({
      page,
    }, testInfo) => {
      const seeded = await seedExpiredBetaAttentionItem(testInfo);

      try {
        await page.goto("/platform/overview");

        const betaActionLink = page.getByRole("link").filter({
          hasText: seeded.email,
        });
        await expect(betaActionLink).toBeVisible({ timeout: 10000 });
        await betaActionLink.focus();
        await expect(betaActionLink).toBeFocused();
        await page.keyboard.press("Enter");
        await page.waitForURL(/\/platform\/beta\?attentionReason=invitation_expired/);
        await expect(page.getByLabel(/^Attention$/i)).toHaveValue(
          "invitation_expired",
        );
      } finally {
        await prisma.betaInvitation.delete({ where: { id: seeded.invitationId } });
        await prisma.betaParticipant.delete({ where: { id: seeded.participantId } });
      }
    });

    test("shows and navigates Action Required beta item on mobile viewport", async ({
      page,
    }, testInfo) => {
      const seeded = await seedExpiredBetaAttentionItem(testInfo);

      try {
        await page.setViewportSize({ width: 375, height: 667 });
        await page.goto("/platform/overview");

        const betaActionLink = page.getByRole("link").filter({
          hasText: seeded.email,
        });
        await expect(betaActionLink).toBeVisible({ timeout: 10000 });
        await expect(betaActionLink).toHaveAttribute(
          "href",
          "/platform/beta?attentionReason=invitation_expired",
        );

        await betaActionLink.click();
        await page.waitForURL(/\/platform\/beta\?attentionReason=invitation_expired/);
        await expect(page.getByLabel(/^Attention$/i)).toHaveValue(
          "invitation_expired",
        );
      } finally {
        await prisma.betaInvitation.delete({ where: { id: seeded.invitationId } });
        await prisma.betaParticipant.delete({ where: { id: seeded.participantId } });
      }
    });

    test("@a11y platform overview with Action Required beta item meets accessibility standards", async ({
      page,
    }, testInfo) => {
      const seeded = await seedExpiredBetaAttentionItem(testInfo);

      try {
        await page.goto("/platform/overview");
        await expect(
          page.getByRole("link").filter({ hasText: seeded.email }),
        ).toBeVisible({ timeout: 10000 });
        await page.waitForLoadState("networkidle");

        await checkA11yLevelAA(page);
      } finally {
        await prisma.betaInvitation.delete({ where: { id: seeded.invitationId } });
        await prisma.betaParticipant.delete({ where: { id: seeded.participantId } });
      }
    });

    test("displays Beta Health stats", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Beta Health/i)).toBeVisible();
      await expect(page.getByText(/Total Alliances/i)).toBeVisible();
      await expect(page.getByText(/Active Today/i)).toBeVisible();
      await expect(page.getByText(/New This Week/i)).toBeVisible();
    });

    test("displays Alliance Readiness summary", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Alliance Readiness/i).first()).toBeVisible();
      await expect(page.getByText(/Ready/i).first()).toBeVisible();
      await expect(page.getByText(/Needs Setup/i).first()).toBeVisible();
    });

    test("displays Setup Funnel", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Setup Funnel/i)).toBeVisible();
      // Use exact match to avoid matching activity feed items
      await expect(page.getByText("Beta Invited")).toBeVisible();
      await expect(page.getByText("Beta Accepted")).toBeVisible();
      await expect(page.getByText("Alliance Created", { exact: true })).toBeVisible();
    });

    test("displays Live Feed", async ({ page }) => {
      await page.goto("/platform/overview");

      await expect(page.getByText(/Live Feed/i).first()).toBeVisible();

      // Should show activity items (linking to platform support) or "No recent activity"
      const hasActivity = await page.locator('[href*="/platform/support/alliance/"]').count() > 0;
      const hasEmptyState = await page.getByText(/no recent activity/i).isVisible();

      expect(hasActivity || hasEmptyState).toBe(true);
    });
  });

  test.describe("Setup Page", () => {
    test("displays Setup Summary with status counts", async ({ page }) => {
      await page.goto("/platform/setup");

      await expect(page.getByText(/Setup Summary/i)).toBeVisible();
      await expect(page.getByText(/Ready/i).first()).toBeVisible();
      await expect(page.getByText(/Needs Setup/i).first()).toBeVisible();
      await expect(page.getByText(/Stalled/i).first()).toBeVisible();
      await expect(page.getByText(/New/i).first()).toBeVisible();
    });

    test("shows alliance cards on mobile viewport", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/platform/setup");

      // On mobile, should see cards not tables
      const hasSections = await page.getByText(/Setup Summary/i).isVisible();
      expect(hasSections).toBe(true);
    });
  });

  test.describe("Support Page", () => {
    test("displays search hint", async ({ page }) => {
      await page.goto("/platform/support");

      await expect(page.getByText(/search bar above/i)).toBeVisible();
    });

    test("displays all alliances list", async ({ page }) => {
      await page.goto("/platform/support");

      await expect(page.getByText(/All Alliances/i)).toBeVisible();
    });

    test("displays needs help section if items exist", async ({ page }) => {
      await page.goto("/platform/support");

      // Support page should have either a "Needs Help" section with items
      // or show "All Alliances" as the primary content
      const hasNeedsHelp = await page.getByText(/Needs Help/i).isVisible();
      const hasAllAlliances = await page.getByText(/All Alliances/i).isVisible();

      // Page must have at least one of these sections
      expect(hasNeedsHelp || hasAllAlliances).toBe(true);
    });

    test("navigates from alliance card to support detail without self-referential action", async ({
      page,
    }) => {
      await page.goto("/platform/support");

      const supportDetailLink = page
        .getByRole("link", { name: /View support details/i })
        .first();

      await expect(supportDetailLink).toBeVisible();
      await supportDetailLink.click();
      await page.waitForURL(/\/platform\/support\/alliance\/.+/);

      const detailPath = new URL(page.url()).pathname;
      expect(detailPath).toMatch(/\/platform\/support\/alliance\/.+/);

      await expect(page.getByText("Open in ACC")).not.toBeVisible();
      await expect(page.getByText("View Details")).not.toBeVisible();

      const selfReferentialLinks = page.locator(`a[href="${detailPath}"]`);
      await expect(selfReferentialLinks).toHaveCount(0);

      const setupBadge = page.getByText(
        /Setup complete|Setup incomplete|Status unavailable/
      );
      await expect(setupBadge).toBeVisible();
    });
  });

  test.describe("Activity Page", () => {
    test("displays Live Feed header", async ({ page }) => {
      await page.goto("/platform/activity");

      await expect(page.getByText(/Live Feed/i)).toBeVisible();
    });

    test("groups activity by date", async ({ page }) => {
      await page.goto("/platform/activity");

      // Should have date headers like "Today", "Yesterday", or actual dates
      const hasDateHeaders =
        (await page.getByText(/Today/i).isVisible()) ||
        (await page.getByText(/Yesterday/i).isVisible()) ||
        (await page.getByText(/No activity yet/i).isVisible());

      expect(hasDateHeaders).toBe(true);
    });
  });

  test.describe("Beta Page", () => {
    test("displays Beta Participants summary", async ({ page }) => {
      await page.goto("/platform/beta");

      await expect(
        page.getByRole("heading", { name: /Beta Participants/i })
      ).toBeVisible();
      await expect(
        page.locator("div").filter({ hasText: /^Participants$/ }).first()
      ).toBeVisible();
      await expect(
        page.locator("div").filter({ hasText: /^Invitation attempts$/ }).first()
      ).toBeVisible();
      await expect(
        page.locator("div").filter({ hasText: /^Accepted$/ }).first()
      ).toBeVisible();
      await expect(page.getByText(/Needs attention/i)).toBeVisible();
      await expect(page.getByText(/Alliances created/i)).toBeVisible();
      await expect(
        page.locator("div").filter({ hasText: /^Setup complete$/ }).first()
      ).toBeVisible();
    });

    test("displays Invite Beta Tester form with beta wave field", async ({ page }) => {
      await page.goto("/platform/beta");

      await expect(
        page.getByRole("heading", { name: /Invite Beta Tester/i })
      ).toBeVisible();
      await expect(page.getByLabel(/email/i)).toBeVisible();
      await expect(page.getByLabel(/beta wave/i)).toBeVisible();
      await expect(page.getByLabel(/notes/i)).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Create Invitation/i })
      ).toBeVisible();
    });

    test("shows validation error for invalid email", async ({ page }) => {
      await page.goto("/platform/beta");

      // Fill with invalid email (no @)
      const emailInput = page.getByLabel(/email/i);
      await emailInput.fill("not-an-email");
      await page.getByRole("button", { name: /Create Invitation/i }).click();

      // Browser HTML5 validation should prevent submission
      // The input should be marked as invalid
      const isInvalid = await emailInput.evaluate(
        (el: HTMLInputElement) => !el.validity.valid
      );
      expect(isInvalid).toBe(true);
    });

    test("creates invitation and shows success card", async ({ page }) => {
      await page.goto("/platform/beta");

      // Generate unique email to avoid conflicts
      const uniqueEmail = `test-${Date.now()}@example.com`;

      // Fill form
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByLabel(/notes/i).fill("E2E test invitation");
      await page.getByRole("button", { name: /Create Invitation/i }).click();

      // Wait for success card heading
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      // Find the success card container (the div with the success heading)
      const successCard = page.locator("div").filter({
        has: page.getByRole("heading", { name: /Invitation Created/i }),
      });

      // Verify success card contents (scoped to avoid matching table)
      await expect(successCard.getByText(uniqueEmail).first()).toBeVisible();
      await expect(successCard.getByRole("button", { name: /Copy Code/i })).toBeVisible();
      await expect(successCard.getByRole("button", { name: /Copy Link/i })).toBeVisible();
      await expect(
        successCard.getByRole("button", { name: /Invite Another/i })
      ).toBeVisible();
    });

    test("Invite Another resets form", async ({ page }) => {
      await page.goto("/platform/beta");

      const uniqueEmail = `test-${Date.now()}@example.com`;

      // Create invitation
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      // Click Invite Another
      await page.getByRole("button", { name: /Invite Another/i }).click();

      // Form should be visible again
      await expect(
        page.getByRole("heading", { name: /Invite Beta Tester/i })
      ).toBeVisible();
      await expect(page.getByLabel(/email/i)).toHaveValue("");
    });

    test("shows duplicate email error", async ({ page }) => {
      await page.goto("/platform/beta");

      const uniqueEmail = `test-dup-${Date.now()}@example.com`;

      // Create first invitation
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      // Try to create another with same email
      await page.getByRole("button", { name: /Invite Another/i }).click();
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();

      // Should show error
      await expect(
        page.getByText(/already has an active invitation/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test("shows reissue guidance after revoking prior invitation", async ({ page }) => {
      await page.goto("/platform/beta");

      const uniqueEmail = `test-reissue-msg-${Date.now()}@example.com`;

      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      await page.getByRole("button", { name: /Invite Another/i }).click();
      await page.setViewportSize({ width: 1280, height: 800 });

      const row = page.locator("table tbody tr").filter({ hasText: uniqueEmail });
      await expect(row).toBeVisible();

      page.on("dialog", (dialog) => dialog.accept());
      await row.getByRole("button", { name: /Revoke/i }).click();
      await expect(row.getByText("Revoked", { exact: true })).toBeVisible({
        timeout: 10000,
      });

      // Invite form is already visible after the first "Invite Another" — no success card to reset.
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();

      await expect(
        page.getByText(/already a beta participant — use Reissue/i)
      ).toBeVisible({ timeout: 10000 });
    });

    test("reissue button appears for revoked participants", async ({ page }) => {
      await page.goto("/platform/beta");

      const uniqueEmail = `test-reissue-btn-${Date.now()}@example.com`;

      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      await page.getByRole("button", { name: /Invite Another/i }).click();
      await page.setViewportSize({ width: 1280, height: 800 });

      const row = page.locator("table tbody tr").filter({ hasText: uniqueEmail });
      page.on("dialog", (dialog) => dialog.accept());
      await row.getByRole("button", { name: /Revoke/i }).click();
      await expect(row.getByText("Revoked", { exact: true })).toBeVisible({
        timeout: 10000,
      });

      await expect(row.getByTestId("reissue-toggle")).toBeVisible();
    });

    test("pending participants show action buttons on latest attempt", async ({ page }) => {
      await page.goto("/platform/beta");

      const uniqueEmail = `test-actions-${Date.now()}@example.com`;
      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      await page.getByRole("button", { name: /Invite Another/i }).click();
      await page.setViewportSize({ width: 1280, height: 800 });

      const participantTable = page.locator("table tbody");
      const row = participantTable.locator("tr").filter({ hasText: uniqueEmail });
      await expect(row).toBeVisible();
      await expect(row.getByRole("button", { name: /Revoke/i })).toBeVisible();
    });

    test("revoke updates participant latest attempt status", async ({ page }) => {
      await page.goto("/platform/beta");

      const uniqueEmail = `test-revoke-${Date.now()}@example.com`;

      await page.getByLabel(/email/i).fill(uniqueEmail);
      await page.getByRole("button", { name: /Create Invitation/i }).click();
      await expect(
        page.getByRole("heading", { name: /Invitation Created/i })
      ).toBeVisible({ timeout: 10000 });

      await page.getByRole("button", { name: /Invite Another/i }).click();
      await page.setViewportSize({ width: 1280, height: 800 });

      const participantTable = page.locator("table tbody");
      const row = participantTable.locator("tr").filter({ hasText: uniqueEmail });
      await expect(row).toBeVisible();

      const revokeButton = row.getByRole("button", { name: /Revoke/i });
      await expect(revokeButton).toBeVisible();

      page.on("dialog", (dialog) => dialog.accept());
      await revokeButton.click();

      await expect(
        row.getByText("Revoked", { exact: true }),
      ).toBeVisible({
        timeout: 10000,
      });
    });

    test("participant filters round-trip via URL", async ({ page }) => {
      await page.goto("/platform/beta?journeyStage=invited");

      await expect(page.getByLabel(/journey stage/i)).toHaveValue("invited");
      await expect(page.getByRole("button", { name: /Apply filters/i })).toBeVisible();
    });

    test("renders at narrow mobile viewport", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/platform/beta");

      await expect(page.getByText(/Beta Participants/i).first()).toBeVisible();
      await expect(
        page.getByRole("heading", { name: /Invite Beta Tester/i })
      ).toBeVisible();
    });

    test("shows journey stage labels for invited and accepted participants", async ({
      page,
    }, testInfo) => {
      const suffix = `${Date.now()}-${testInfo.retry}-${Math.random().toString(36).slice(2, 8)}`;
      const invitedEmail = `e2e-journey-invited-${suffix}@example.test`;
      const acceptedEmail = `e2e-journey-accepted-${suffix}@example.test`;

      const invitedParticipant = await prisma.betaParticipant.create({ data: {} });
      const invitedInvitation = await prisma.betaInvitation.create({
        data: {
          participantId: invitedParticipant.id,
          email: invitedEmail,
          code: `INV-${suffix.slice(0, 6).toUpperCase()}`,
          token: crypto.randomUUID(),
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const acceptedUser = await prisma.user.create({
        data: {
          email: acceptedEmail,
          displayName: `Accepted Journey ${suffix}`,
          passwordHash: "hash",
        },
      });
      const acceptedParticipant = await prisma.betaParticipant.create({
        data: { userId: acceptedUser.id },
      });
      const acceptedInvitation = await prisma.betaInvitation.create({
        data: {
          participantId: acceptedParticipant.id,
          email: acceptedEmail,
          code: `ACC-${suffix.slice(0, 6).toUpperCase()}`,
          token: crypto.randomUUID(),
          issuedAt: new Date(),
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          acceptedAt: new Date(),
          acceptedByUserId: acceptedUser.id,
        },
      });

      try {
        await page.setViewportSize({ width: 1280, height: 800 });
        await page.goto(`/platform/beta?search=${suffix}`);

        const invitedRow = page.locator("table tbody tr").filter({ hasText: invitedEmail });
        const acceptedRow = page.locator("table tbody tr").filter({ hasText: acceptedEmail });

        await expect(invitedRow).toBeVisible();
        await expect(invitedRow.locator("td").nth(2)).toContainText("Invited");
        await expect(acceptedRow).toBeVisible();
        await expect(acceptedRow.locator("td").nth(2)).toContainText("Accepted");
      } finally {
        await prisma.betaInvitation.deleteMany({
          where: { id: { in: [invitedInvitation.id, acceptedInvitation.id] } },
        });
        await prisma.betaParticipant.deleteMany({
          where: { id: { in: [invitedParticipant.id, acceptedParticipant.id] } },
        });
        await prisma.user.delete({ where: { id: acceptedUser.id } });
      }
    });
  });

  test.describe("Search Functionality", () => {
    test("search input is accessible from all pages", async ({ page }) => {
      const pages = [
        "/platform/overview",
        "/platform/setup",
        "/platform/support",
        "/platform/activity",
        "/platform/beta",
      ];

      for (const pagePath of pages) {
        await page.goto(pagePath);
        await expect(
          page.getByPlaceholder(/search alliances/i)
        ).toBeVisible();
      }
    });

    test("search shows results dropdown", async ({ page }) => {
      await page.goto("/platform/overview");

      const searchInput = page.getByPlaceholder(/search alliances/i);
      await searchInput.fill("DA");

      // Search was triggered once either the results dropdown or the empty
      // state renders. Use a web-first assertion (auto-retries through the
      // debounce + API response) instead of a fixed wait plus instant check,
      // which races under load.
      const resultsDropdown = page.locator("ul.max-h-64");
      const noResultsMessage = page.getByText(/No results for/i);

      await expect(resultsDropdown.or(noResultsMessage).first()).toBeVisible();
    });
  });

  test.describe("Mobile Responsiveness", () => {
    test("mobile menu button is visible on small screens", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/platform/overview");

      // Mobile menu button should be visible
      const menuButton = page.locator('button[aria-label*="menu"], button:has(svg)').first();
      await expect(menuButton).toBeVisible();
    });

    test("navigation sidebar is hidden on mobile", async ({ page }) => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto("/platform/overview");

      // Desktop nav should be hidden
      const desktopNav = page.locator("aside.lg\\:flex");
      await expect(desktopNav).toBeHidden();
    });
  });
});
