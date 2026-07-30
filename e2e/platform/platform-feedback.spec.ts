import { test, expect } from "../shared/fixtures";
import { checkA11yWithOptions } from "../shared/accessibility";
import { prisma } from "@/app/src/lib/prisma";
import { recordFeedbackTriageEvent } from "@/app/src/lib/feedbackTriage";

async function seedFeedbackItem(args: {
  suffix: string;
  message: string;
  category?: "BUG" | "IDEA" | "CONFUSING";
  allianceId?: string | null;
  status?: "NEW" | "TRIAGED" | "PLANNED" | "RESOLVED" | "DISMISSED";
  needsResponse?: boolean;
  withTriage?: boolean;
  submitterEmail?: string;
  submitterDisplayName?: string | null;
  userId?: string | null;
}) {
  const suffix = args.suffix;
  let userId = args.userId;
  let submitterEmail = args.submitterEmail;
  let submitterDisplayName = args.submitterDisplayName ?? null;

  if (userId === undefined) {
    const user = await prisma.user.create({
      data: {
        email: `fb-e2e-${suffix}@example.test`,
        displayName: `E2E Submitter ${suffix}`,
        passwordHash: "hash",
      },
    });
    userId = user.id;
    submitterEmail = submitterEmail ?? user.email;
    submitterDisplayName = submitterDisplayName ?? user.displayName;
  }

  const feedback = await prisma.feedback.create({
    data: {
      userId,
      submitterEmail: submitterEmail!,
      submitterDisplayName,
      category: args.category ?? "BUG",
      message: args.message,
      url: "https://example.test/alliances/all_1",
      allianceId: args.allianceId ?? null,
      triage:
        args.withTriage === false
          ? undefined
          : {
              create: {
                status: args.status ?? "NEW",
                needsResponse: args.needsResponse ?? true,
                stateRevision: 0,
              },
            },
    },
    include: { triage: true },
  });

  return feedback;
}

function desktopFeedbackItem(page: import("@playwright/test").Page, feedbackId: string) {
  return page.getByTestId(`feedback-row-${feedbackId}`);
}

function mobileFeedbackItem(page: import("@playwright/test").Page, feedbackId: string) {
  return page.getByTestId(`feedback-card-${feedbackId}`);
}

test.describe("Platform Feedback Inbox", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !process.env.TEST_PLATFORM_ADMIN_EMAIL ||
        !process.env.TEST_PLATFORM_ADMIN_PASSWORD,
      "TEST_PLATFORM_ADMIN_EMAIL and TEST_PLATFORM_ADMIN_PASSWORD required",
    );

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

  test("displays Feedback nav entry and inbox summary", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto("/platform/feedback");

    await expect(
      page.getByRole("heading", { name: /Feedback Inbox/i }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Feedback", exact: true })).toBeVisible();
    await expect(page.getByText(/^Total$/).first()).toBeVisible();
    await expect(page.getByText(/^Needs response$/).first()).toBeVisible();
  });

  test("filter and summary-card round-trip via URL params", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const feedback = await seedFeedbackItem({
      suffix,
      message: `E2E filter round-trip ${suffix}`,
      category: "BUG",
      status: "NEW",
    });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/feedback?search=${encodeURIComponent(suffix)}`);

      const row = desktopFeedbackItem(page, feedback.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await expect(row).toContainText(`E2E filter round-trip ${suffix}`);
      expect(page.url()).toContain(`search=${encodeURIComponent(suffix)}`);

      await page.getByRole("link", { name: "New", exact: true }).click();
      await page.waitForURL(/status=NEW/);
      await expect(row).toContainText(`E2E filter round-trip ${suffix}`);

      await page.getByRole("link", { name: "Total", exact: true }).click();
      await page.waitForURL(/\/platform\/feedback\?search=/);
      expect(page.url()).not.toContain("status=NEW");
    } finally {
      await prisma.feedback.delete({ where: { id: feedback.id } });
      if (feedback.userId) {
        await prisma.user.delete({ where: { id: feedback.userId } }).catch(() => {});
      }
    }
  });

  test("records status change, note, needs-response toggle, and GitHub URL", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const feedback = await seedFeedbackItem({
      suffix,
      message: `E2E triage journey ${suffix}`,
    });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/feedback?search=${encodeURIComponent(suffix)}`);
      const row = desktopFeedbackItem(page, feedback.id);
      await expect(row).toBeVisible({ timeout: 15000 });

      await row.getByRole("button", { name: /^Triage$/ }).click();
      const panel = row.locator('[data-testid="feedback-triage-panel"]');
      await expect(panel).toBeVisible();

      await panel.locator(`#triage-status-${feedback.id}`).selectOption("TRIAGED");
      await panel.getByLabel(/Needs response/i).uncheck();
      await panel
        .locator(`#triage-github-${feedback.id}`)
        .fill("https://github.com/org/repo/issues/99");
      await panel.locator(`#triage-note-${feedback.id}`).fill("Tracked in GitHub");
      await panel.getByTestId("triage-submit").click();

      await expect(panel.getByTestId("triage-success")).toBeVisible({
        timeout: 10000,
      });

      await page.reload();
      await expect(row.getByText("Triaged")).toBeVisible();
      await expect(row.getByText("No response needed")).toBeVisible();
      await expect(
        row.getByRole("link", { name: "https://github.com/org/repo/issues/99" }),
      ).toBeVisible();
    } finally {
      await prisma.feedback.delete({ where: { id: feedback.id } });
      if (feedback.userId) {
        await prisma.user.delete({ where: { id: feedback.userId } }).catch(() => {});
      }
    }
  });

  test("rejects invalid GitHub URL from server validation", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const feedback = await seedFeedbackItem({
      suffix,
      message: `E2E invalid github ${suffix}`,
    });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/feedback?search=${encodeURIComponent(suffix)}`);
      const row = desktopFeedbackItem(page, feedback.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByRole("button", { name: /^Triage$/ }).click();
      const panel = row.locator('[data-testid="feedback-triage-panel"]');
      await panel
        .locator(`#triage-github-${feedback.id}`)
        .fill("https://example.com/not-github");
      await panel.getByTestId("triage-submit").click();

      await expect(panel.getByTestId("triage-error")).toBeVisible({
        timeout: 10000,
      });
      await expect(panel.getByTestId("triage-error")).toContainText(/GitHub URL must match/i);
    } finally {
      await prisma.feedback.delete({ where: { id: feedback.id } });
      if (feedback.userId) {
        await prisma.user.delete({ where: { id: feedback.userId } }).catch(() => {});
      }
    }
  });

  test("shows stale-conflict recovery when concurrent triage changes state", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const feedback = await seedFeedbackItem({
      suffix,
      message: `E2E stale conflict ${suffix}`,
      status: "NEW",
    });

    const operator = await prisma.user.findFirst({
      where: { email: process.env.TEST_PLATFORM_ADMIN_EMAIL! },
      select: { id: true },
    });
    test.skip(!operator, "Platform admin user not found in database");

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/feedback?search=${encodeURIComponent(suffix)}`);
      const row = desktopFeedbackItem(page, feedback.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByRole("button", { name: /^Triage$/ }).click();
      const panel = row.locator('[data-testid="feedback-triage-panel"]');
      await panel.locator(`#triage-status-${feedback.id}`).selectOption("TRIAGED");

      await recordFeedbackTriageEvent(
        feedback.id,
        operator!.id,
        { status: "PLANNED" },
        0,
      );

      await panel.getByTestId("triage-submit").click();
      await expect(panel.getByTestId("stale-conflict-recovery")).toBeVisible({
        timeout: 10000,
      });
      await expect(panel.getByTestId("stale-conflict-recovery")).toContainText(
        /Current status/i,
      );

      await panel.getByTestId("stale-conflict-refresh").click();
      await expect(panel.getByTestId("triage-success")).toBeVisible({
        timeout: 10000,
      });
      await panel.getByTestId("triage-submit").click();
      await expect(panel.getByTestId("triage-success")).toBeVisible({
        timeout: 10000,
      });
    } finally {
      await prisma.feedback.delete({ where: { id: feedback.id } });
      if (feedback.userId) {
        await prisma.user.delete({ where: { id: feedback.userId } }).catch(() => {});
      }
    }
  });

  test("renders at narrow mobile viewport", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const feedback = await seedFeedbackItem({
      suffix,
      message: `E2E mobile feedback ${suffix}`,
    });

    try {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(`/platform/feedback?search=${encodeURIComponent(suffix)}`);

      await expect(page.getByText(/Feedback Inbox/i).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Apply filters/i })).toBeVisible();
      await expect(mobileFeedbackItem(page, feedback.id)).toBeVisible();
    } finally {
      await prisma.feedback.delete({ where: { id: feedback.id } });
      if (feedback.userId) {
        await prisma.user.delete({ where: { id: feedback.userId } }).catch(() => {});
      }
    }
  });

  test("activates Feedback nav link via keyboard", async ({ page }) => {
    await page.goto("/platform/overview");
    const feedbackLink = page.getByRole("link", { name: "Feedback", exact: true });
    await feedbackLink.focus();
    await expect(feedbackLink).toBeFocused();
    await page.keyboard.press("Enter");
    await page.waitForURL("/platform/feedback");
    await expect(page.getByRole("heading", { name: /Feedback Inbox/i })).toBeVisible();
  });

  test("@a11y platform feedback inbox meets accessibility standards", async ({
    page,
  }) => {
    await page.goto("/platform/feedback");
    await page.waitForLoadState("networkidle");

    await checkA11yWithOptions(page, {
      runOnly: ["wcag2a", "wcag2aa"],
      include: ['[data-testid="platform-feedback-page"]'],
    });
  });
});
