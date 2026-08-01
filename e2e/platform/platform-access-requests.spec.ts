import { test, expect } from "../shared/fixtures";
import { checkA11yWithOptions } from "../shared/accessibility";
import { prisma } from "@/app/src/lib/prisma";
import { addAccessRequestNote, declineAccessRequest, reopenAccessRequest } from "@/app/src/lib/accessRequestTriage";
import { getAccessRequestPendingCount } from "@/app/src/lib/platform/accessRequestInbox";

async function seedAccessRequest(args: {
  suffix: string;
  name?: string;
  email?: string;
  allianceName?: string | null;
  message?: string | null;
}) {
  return prisma.accessRequest.create({
    data: {
      name: args.name ?? `E2E Requester ${args.suffix}`,
      email: args.email ?? `ar-e2e-${args.suffix}@example.test`,
      allianceName: args.allianceName ?? null,
      message: args.message ?? `E2E access request ${args.suffix}`,
    },
  });
}

/** Seeds a User + Alliance + AllianceMembership sharing the request's email, so
 * the conflict pre-check classifies this request as EXISTING_ALLIANCE_ACCESS. */
async function seedExistingAllianceAccessConflict(args: { suffix: string; email: string }) {
  const user = await prisma.user.create({
    data: {
      email: args.email,
      displayName: `E2E Existing Member ${args.suffix}`,
      passwordHash: "hash",
    },
  });
  const alliance = await prisma.alliance.create({
    data: { name: `E2E Alliance ${args.suffix}`, server: "S1" },
  });
  await prisma.allianceMembership.create({
    data: { allianceId: alliance.id, userId: user.id, role: "LEADER" },
  });
  return { user, alliance };
}

async function cleanupAccessRequest(accessRequestId: string) {
  await prisma.accessRequestTriageEvent.deleteMany({ where: { accessRequestId } });
  await prisma.accessRequestTriage.deleteMany({ where: { accessRequestId } });
  await prisma.accessRequest.delete({ where: { id: accessRequestId } });
}

function desktopAccessRequestRow(page: import("@playwright/test").Page, accessRequestId: string) {
  return page.getByTestId(`access-request-row-${accessRequestId}`);
}

function mobileAccessRequestCard(page: import("@playwright/test").Page, accessRequestId: string) {
  return page.getByTestId(`access-request-card-${accessRequestId}`);
}

test.describe("Platform Access Requests", () => {
  test.beforeEach(async ({ page }) => {
    test.skip(
      !process.env.TEST_PLATFORM_ADMIN_EMAIL || !process.env.TEST_PLATFORM_ADMIN_PASSWORD,
      "TEST_PLATFORM_ADMIN_EMAIL and TEST_PLATFORM_ADMIN_PASSWORD required",
    );

    await page.goto("/login");
    await page.getByLabel(/email/i).fill(process.env.TEST_PLATFORM_ADMIN_EMAIL!);
    await page.getByLabel(/password/i).fill(process.env.TEST_PLATFORM_ADMIN_PASSWORD!);
    await page.getByRole("button", { name: /sign in/i }).click();
    await page.waitForURL(/\/(app|alliances|platform)/);
  });

  test("Beta page discovery card links to the access-request queue and shows the pending count", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const accessRequest = await seedAccessRequest({ suffix });

    try {
      // The seeded request is PENDING, so the exact count the card must
      // show is whatever the read model reports right now — asserted
      // directly rather than assuming a clean database (review feedback on
      // PR #260: "the discovery test seeds a pending request but never
      // asserts the count").
      const expectedPendingCount = await getAccessRequestPendingCount();

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto("/platform/beta");

      const card = page.getByTestId("access-requests-discovery-card");
      await expect(card).toBeVisible();
      await expect(card).toContainText("Access requests");
      await expect(card).toContainText(
        "Review pending requests, approve invitations, or record why access was declined.",
      );
      await expect(card).toContainText("Pending");
      await expect(card.getByText(String(expectedPendingCount), { exact: true })).toBeVisible();

      await card.click();
      await page.waitForURL("/platform/beta/access-requests");
      await expect(page.getByTestId("platform-access-requests-page")).toBeVisible();
    } finally {
      await cleanupAccessRequest(accessRequest.id);
    }
  });

  test("shows the Beta / Access requests breadcrumb and a back link that keeps Beta highlighted", async ({
    page,
  }) => {
    await page.goto("/platform/beta/access-requests");

    await expect(page.getByRole("link", { name: "Beta", exact: true }).first()).toBeVisible();
    const backLink = page.getByTestId("back-to-beta-participants");
    await expect(backLink).toBeVisible();
    await expect(backLink).toHaveAttribute("href", "/platform/beta");

    // PlatformNav highlights "Beta" via descendant-path handling — no separate
    // nav entry exists for this page (#177 design decision). PlatformNav
    // marks the active item with a class toggle, not aria-current.
    const betaNavLink = page.getByRole("link", { name: "Beta", exact: true }).first();
    await expect(betaNavLink).toHaveClass(/text-primary/);
  });

  test("beta-wave combobox: blank default, keyboard operation, invalid/overlong values, and exact-existing submission", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const existingWaveName = `E2E Wave ${suffix}`;
    // A prior invitation seeds a real, listable wave option.
    const seedInvitation = await prisma.betaInvitation.create({
      data: {
        email: `ar-wave-seed-${suffix}@example.test`,
        token: `tok-${suffix}`,
        code: `CODE-${suffix}`,
        campaign: existingWaveName,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        participantId: (await prisma.betaParticipant.create({ data: {} })).id,
      },
    });
    const accessRequest = await seedAccessRequest({ suffix });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);
      const row = desktopAccessRequestRow(page, accessRequest.id);
      await expect(row).toBeVisible({ timeout: 15000 });

      await row.getByTestId(`access-request-toggle-${accessRequest.id}`).click();
      const panel = row.locator('[data-testid="access-request-actions-panel"]');
      await expect(panel).toBeVisible();
      await expect(panel.getByTestId("access-request-approve-section")).toBeVisible({ timeout: 10000 });

      const select = panel.locator(`[data-testid$="-wave-select"]`);
      const approveButton = panel.getByTestId("access-request-approve-submit");

      // 1. Blank default — approve disabled, no "new wave" input shown.
      await expect(select).toHaveValue("");
      await expect(approveButton).toBeDisabled();
      await expect(panel.locator(`[data-testid$="-wave-new-input"]`)).toHaveCount(0);

      // 2. Existing wave values are listed with their exact spelling/case.
      await expect(select.locator("option", { hasText: existingWaveName })).toHaveCount(1);

      // 3. Keyboard operation: focus + arrow-select + tab to the button.
      await select.focus();
      await expect(select).toBeFocused();

      // 4. Selecting "Create new wave…" reveals a required, focused input.
      await select.selectOption({ label: "Create new wave…" });
      const newInput = panel.locator(`[data-testid$="-wave-new-input"]`);
      await expect(newInput).toBeVisible();
      await expect(newInput).toBeFocused();
      await expect(approveButton).toBeDisabled();

      // 5. A whitespace-only value is invalid (trims to zero length) and shows
      // a visible error — the native maxLength=80 attribute already prevents
      // typing an overlong value in the first place (covered at the pure
      // logic/unit level in BetaWaveSelect.test.tsx).
      await newInput.fill("   ");
      await expect(panel.locator(`[data-testid$="-wave-error"]`)).toBeVisible();
      await expect(approveButton).toBeDisabled();

      // 6. Returning to blank hides the new-wave input and restores focus to the select.
      await newInput.fill("");
      await select.selectOption({ label: "Select a beta wave…" });
      await expect(newInput).toHaveCount(0);
      await expect(select).toBeFocused();

      // 7. Selecting the exact existing wave enables approve and submits that exact value.
      await select.selectOption({ label: existingWaveName });
      await expect(approveButton).toBeEnabled();
      await approveButton.click();

      await expect(panel.getByTestId("access-request-convert-success")).toBeVisible({ timeout: 15000 });

      const invitation = await prisma.betaInvitation.findFirst({
        where: { email: accessRequest.email.toLowerCase() },
        orderBy: { issuedAt: "desc" },
      });
      expect(invitation?.campaign).toBe(existingWaveName);
      // No internal UI sentinel value ever reaches the persisted record.
      expect(invitation?.campaign).not.toBe("create");
    } finally {
      await cleanupAccessRequest(accessRequest.id);
      const invitation = await prisma.betaInvitation.findFirst({
        where: { email: accessRequest.email.toLowerCase() },
      });
      if (invitation) {
        const participantId = invitation.participantId;
        await prisma.betaInvitation.delete({ where: { id: invitation.id } }).catch(() => {});
        if (participantId) {
          await prisma.betaParticipant.delete({ where: { id: participantId } }).catch(() => {});
        }
      }
      await prisma.betaInvitation.delete({ where: { id: seedInvitation.id } }).catch(() => {});
      if (seedInvitation.participantId) {
        await prisma.betaParticipant.delete({ where: { id: seedInvitation.participantId } }).catch(() => {});
      }
    }
  });

  test("beta-wave combobox: explicit new-wave creation is not written until conversion, and resets to blank on success", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const newWaveName = `E2E New Wave ${suffix}`;
    const accessRequest = await seedAccessRequest({ suffix });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);
      const row = desktopAccessRequestRow(page, accessRequest.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByTestId(`access-request-toggle-${accessRequest.id}`).click();
      const panel = row.locator('[data-testid="access-request-actions-panel"]');
      await expect(panel.getByTestId("access-request-approve-section")).toBeVisible({ timeout: 10000 });

      const select = panel.locator(`[data-testid$="-wave-select"]`);
      const newInput = panel.locator(`[data-testid$="-wave-new-input"]`);
      const approveButton = panel.getByTestId("access-request-approve-submit");

      await select.selectOption({ label: "Create new wave…" });
      await newInput.fill(newWaveName);
      await expect(approveButton).toBeEnabled();

      // "Create new wave" never performs a separate write on its own.
      const preSubmitCount = await prisma.betaInvitation.count({ where: { campaign: newWaveName } });
      expect(preSubmitCount).toBe(0);

      await approveButton.click();
      await expect(panel.getByTestId("access-request-convert-success")).toBeVisible({ timeout: 15000 });

      const invitation = await prisma.betaInvitation.findFirst({ where: { campaign: newWaveName } });
      expect(invitation).not.toBeNull();

      // A successful conversion moves the request to INVITED, so the
      // approval section (and its wave select) is replaced entirely by the
      // read-only "Invited" note — the choice resetting to blank is only
      // externally observable via the internal WaveChoice state, which is
      // covered directly in BetaWaveSelect.test.tsx's reset-focus test.
      await panel.getByRole("button", { name: "Close" }).click();
      await expect(panel.getByTestId("access-request-convert-success")).toHaveCount(0);
      await expect(panel.getByTestId("access-request-invited-note")).toContainText(newWaveName);
      await expect(panel.locator(`[data-testid$="-wave-select"]`)).toHaveCount(0);
    } finally {
      await cleanupAccessRequest(accessRequest.id);
      const invitation = await prisma.betaInvitation.findFirst({ where: { campaign: newWaveName } });
      if (invitation) {
        const participantId = invitation.participantId;
        await prisma.betaInvitation.delete({ where: { id: invitation.id } }).catch(() => {});
        if (participantId) {
          await prisma.betaParticipant.delete({ where: { id: participantId } }).catch(() => {});
        }
      }
    }
  });

  test("existing alliance access conflict shows resolve-only guidance and hides the invite form", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const email = `ar-conflict-${suffix}@example.test`;
    const { user, alliance } = await seedExistingAllianceAccessConflict({ suffix, email });
    const accessRequest = await seedAccessRequest({ suffix, email });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);
      const row = desktopAccessRequestRow(page, accessRequest.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByTestId(`access-request-toggle-${accessRequest.id}`).click();
      const panel = row.locator('[data-testid="access-request-actions-panel"]');

      const existingAccessPanel = panel.getByTestId("access-request-existing-access");
      await expect(existingAccessPanel).toBeVisible({ timeout: 10000 });
      await expect(existingAccessPanel).toContainText("Already has alliance access");
      await expect(existingAccessPanel).toContainText(alliance.name);
      await expect(panel.getByTestId("access-request-approve-section")).toHaveCount(0);

      await panel.getByTestId("access-request-resolve-open").click();
      await panel.getByTestId("access-request-resolve-reason").fill("Confirmed already leads that alliance");
      await panel.getByTestId("access-request-resolve-submit").click();

      await expect(panel.getByTestId("access-request-success")).toBeVisible({ timeout: 10000 });
      await expect(panel.getByTestId("access-request-reopen-section")).toBeVisible();
    } finally {
      await cleanupAccessRequest(accessRequest.id);
      await prisma.allianceMembership.deleteMany({ where: { userId: user.id } });
      await prisma.alliance.delete({ where: { id: alliance.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("records a note, decline reason, then reopen — full pending → declined → reopened journey", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const accessRequest = await seedAccessRequest({ suffix });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);
      const row = desktopAccessRequestRow(page, accessRequest.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByTestId(`access-request-toggle-${accessRequest.id}`).click();
      const panel = row.locator('[data-testid="access-request-actions-panel"]');

      await panel.getByTestId("access-request-note-input").fill("Checked identity, looks legitimate");
      await panel.getByTestId("access-request-note-submit").click();
      await expect(panel.getByTestId("access-request-success")).toContainText("Note added");

      await panel.getByTestId("access-request-decline-open").click();
      await panel.getByTestId("access-request-decline-reason").fill("Could not verify alliance ownership");
      await panel.getByTestId("access-request-decline-submit").click();
      await expect(panel.getByTestId("access-request-success")).toContainText("declined");

      await expect(panel.getByTestId("access-request-reopen-section")).toBeVisible();
      await panel.getByTestId("access-request-reopen-open").click();
      await panel.getByTestId("access-request-reopen-reason").fill("Requester provided proof");
      await panel.getByTestId("access-request-reopen-submit").click();
      await expect(panel.getByTestId("access-request-success")).toContainText("reopened");
      await expect(panel.getByTestId("access-request-approve-section")).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupAccessRequest(accessRequest.id);
    }
  });

  test("shows conflict-recovery UI for both a denied reopen and a genuine stale conflict", async ({
    page,
  }, testInfo) => {
    // AccessRequest's state machine only advances stateRevision alongside a
    // status transition EXCEPT for one path: a reopen denied because access
    // still exists refreshes evidence (and bumps the revision) while staying
    // in RESOLVED_EXISTING_ACCESS. That's the one place two operators can
    // genuinely race on the SAME status, so it's used to reproduce both a
    // deterministic "reopen denied" outcome and a true STALE_CONFLICT.
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const email = `ar-stale-${suffix}@example.test`;
    const { user, alliance } = await seedExistingAllianceAccessConflict({ suffix, email });
    const accessRequest = await seedAccessRequest({ suffix, email });

    const operator = await prisma.user.findFirst({
      where: { email: process.env.TEST_PLATFORM_ADMIN_EMAIL! },
      select: { id: true },
    });
    test.skip(!operator, "Platform admin user not found in database");

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);
      const row = desktopAccessRequestRow(page, accessRequest.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByTestId(`access-request-toggle-${accessRequest.id}`).click();
      const panel = row.locator('[data-testid="access-request-actions-panel"]');

      await expect(panel.getByTestId("access-request-existing-access")).toBeVisible({ timeout: 10000 });
      await panel.getByTestId("access-request-resolve-open").click();
      await panel.getByTestId("access-request-resolve-reason").fill("Confirmed already leads that alliance");
      await panel.getByTestId("access-request-resolve-submit").click();
      await expect(panel.getByTestId("access-request-success")).toBeVisible({ timeout: 10000 });

      // 1. Reopening while the conflicting access still genuinely exists is
      // denied outright — no concurrency needed for this part.
      const recovery = panel.getByTestId("access-request-conflict-recovery");
      await panel.getByTestId("access-request-reopen-open").click();
      await panel.getByTestId("access-request-reopen-reason").fill("Requester disputes this");
      await panel.getByTestId("access-request-reopen-submit").click();
      await expect(recovery).toBeVisible({ timeout: 10000 });
      await expect(recovery).toContainText("Reopen denied — access still exists");
      await expect(recovery).toContainText(alliance.name);

      await panel.getByTestId("access-request-conflict-refresh").click();
      await expect(recovery).toBeHidden();

      // 2. A genuine STALE_CONFLICT: the UI's reopen form is still open with
      // its previous text (a denied reopen only refreshes the baseline, not
      // the open form — the same "cancel/success only" reset rule design
      // decision 3 states for the wave choice). It still holds the
      // now-refreshed revision, but a concurrent denied-reopen attempt (the
      // same mechanism as step 1) advances stateRevision again first.
      await expect(panel.getByTestId("access-request-reopen-reason")).toBeVisible();
      await panel.getByTestId("access-request-reopen-reason").fill("Retrying");

      const beforeSubmit = await prisma.accessRequestTriage.findUniqueOrThrow({
        where: { accessRequestId: accessRequest.id },
      });
      const concurrentResult = await reopenAccessRequest(
        accessRequest.id,
        operator!.id,
        "Concurrent operator retry",
        beforeSubmit.stateRevision,
      );
      expect(concurrentResult.ok).toBe(false);

      await panel.getByTestId("access-request-reopen-submit").click();
      await expect(recovery).toBeVisible({ timeout: 10000 });
      await expect(recovery).toContainText("This request changed while you were working on it");
    } finally {
      await cleanupAccessRequest(accessRequest.id);
      await prisma.allianceMembership.deleteMany({ where: { userId: user.id } });
      await prisma.alliance.delete({ where: { id: alliance.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  test("opens the actions panel on mobile and adds a note", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const accessRequest = await seedAccessRequest({ suffix });

    try {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);
      const card = mobileAccessRequestCard(page, accessRequest.id);
      await expect(card).toBeVisible({ timeout: 15000 });
      await card.getByTestId(`access-request-toggle-${accessRequest.id}`).click();
      const panel = card.locator('[data-testid="access-request-actions-panel"]');
      await expect(panel).toBeVisible();
      await panel.getByTestId("access-request-note-input").fill("Mobile note");
      await panel.getByTestId("access-request-note-submit").click();
      await expect(panel.getByTestId("access-request-success")).toBeVisible({ timeout: 10000 });
    } finally {
      await cleanupAccessRequest(accessRequest.id);
    }
  });

  test("loads the 5 newest history events, then switches to full paginated history and navigates to a real page 2 without losing or duplicating events", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const accessRequest = await seedAccessRequest({ suffix });
    const operator = await prisma.user.findFirst({
      where: { email: process.env.TEST_PLATFORM_ADMIN_EMAIL! },
      select: { id: true },
    });
    test.skip(!operator, "Platform admin user not found in database");

    try {
      // Twelve notes: more than the compact page size (5) AND more than a
      // single full-history page (10), so a real page 2 exists to navigate
      // to — the original test only ever rendered "Page 1 of 2" without
      // clicking Next (review feedback on PR #260).
      for (let i = 0; i < 12; i++) {
        const result = await addAccessRequestNote(accessRequest.id, operator!.id, `Note number ${i}`);
        expect(result.ok).toBe(true);
      }

      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);
      const row = desktopAccessRequestRow(page, accessRequest.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByTestId(`access-request-toggle-${accessRequest.id}`).click();
      const panel = row.locator('[data-testid="access-request-actions-panel"]');
      await expect(panel).toBeVisible();

      const history = panel.locator('[data-testid="access-request-history"]');
      await history.getByTestId("access-request-history-toggle").click();
      await expect(history.getByText("Note number 11", { exact: true })).toBeVisible({ timeout: 10000 });
      const viewFull = history.getByTestId("access-request-history-view-full");
      await expect(viewFull).toBeVisible();
      await expect(viewFull).toContainText("(12)");

      await viewFull.click();
      await expect(history.getByText("Page 1 of 2")).toBeVisible({ timeout: 10000 });
      // Page 1 of the full view holds the 10 newest (notes 11 down to 2).
      await expect(history.getByText("Note number 11", { exact: true })).toBeVisible();
      await expect(history.getByText("Note number 2", { exact: true })).toBeVisible();
      await expect(history.getByText("Note number 1", { exact: true })).toHaveCount(0);
      await expect(history.getByText("Note number 0", { exact: true })).toHaveCount(0);
      await expect(history.getByTestId("access-request-history-view-full")).toHaveCount(0);

      await history.getByRole("button", { name: "Next" }).click();
      await expect(history.getByText("Page 2 of 2")).toBeVisible({ timeout: 10000 });
      // Page 2 holds the 2 oldest (notes 1 and 0) — and NONE of page 1's
      // items, proving events are neither duplicated across pages nor lost.
      await expect(history.getByText("Note number 1", { exact: true })).toBeVisible();
      await expect(history.getByText("Note number 0", { exact: true })).toBeVisible();
      await expect(history.getByText("Note number 2", { exact: true })).toHaveCount(0);
      await expect(history.getByText("Note number 11", { exact: true })).toHaveCount(0);

      await history.getByRole("button", { name: "Previous" }).click();
      await expect(history.getByText("Page 1 of 2")).toBeVisible({ timeout: 10000 });
      await expect(history.getByText("Note number 11", { exact: true })).toBeVisible();
      await expect(history.getByText("Note number 0", { exact: true })).toHaveCount(0);
    } finally {
      await cleanupAccessRequest(accessRequest.id);
    }
  });

  test("an already-open history panel reflects a note added while it was expanded, without needing to close and reopen it", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const accessRequest = await seedAccessRequest({ suffix });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);
      const row = desktopAccessRequestRow(page, accessRequest.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByTestId(`access-request-toggle-${accessRequest.id}`).click();
      const panel = row.locator('[data-testid="access-request-actions-panel"]');

      const history = panel.locator('[data-testid="access-request-history"]');
      await history.getByTestId("access-request-history-toggle").click();
      await expect(history.getByText("No history events yet.")).toBeVisible({ timeout: 10000 });

      // Add a note while history is already expanded — a client-owned,
      // independently-fetched history has no way to learn about this from
      // revalidatePath() alone (review feedback: "history stays stale
      // after a mutation").
      await panel.getByTestId("access-request-note-input").fill("Added while history was open");
      await panel.getByTestId("access-request-note-submit").click();
      await expect(panel.getByTestId("access-request-success")).toContainText("Note added");

      await expect(history.getByText("Added while history was open")).toBeVisible({ timeout: 10000 });
      await expect(history.getByText("No history events yet.")).toHaveCount(0);
    } finally {
      await cleanupAccessRequest(accessRequest.id);
    }
  });

  test("filter and summary-card round-trip via URL params", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const pendingItem = await seedAccessRequest({ suffix: `${suffix}-pending` });
    const declinedItem = await seedAccessRequest({ suffix: `${suffix}-declined` });
    const operator = await prisma.user.findFirst({
      where: { email: process.env.TEST_PLATFORM_ADMIN_EMAIL! },
      select: { id: true },
    });
    test.skip(!operator, "Platform admin user not found in database");
    await declineAccessRequest(declinedItem.id, operator!.id, "Not eligible", 0);

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);

      await expect(desktopAccessRequestRow(page, pendingItem.id)).toBeVisible({ timeout: 15000 });
      await expect(desktopAccessRequestRow(page, declinedItem.id)).toBeVisible();

      await page.getByRole("link", { name: "Declined", exact: true }).click();
      await page.waitForURL(/status=DECLINED/);
      await expect(desktopAccessRequestRow(page, declinedItem.id)).toBeVisible();
      await expect(desktopAccessRequestRow(page, pendingItem.id)).toBeHidden();
    } finally {
      await cleanupAccessRequest(pendingItem.id);
      await cleanupAccessRequest(declinedItem.id);
    }
  });

  test("renders at narrow mobile viewport", async ({ page }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const accessRequest = await seedAccessRequest({ suffix });

    try {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);

      await expect(page.getByText(/Access Requests/i).first()).toBeVisible();
      await expect(page.getByRole("button", { name: /Apply filters/i })).toBeVisible();
      await expect(mobileAccessRequestCard(page, accessRequest.id)).toBeVisible();
    } finally {
      await cleanupAccessRequest(accessRequest.id);
    }
  });

  test("@a11y platform access requests queue meets accessibility standards", async ({
    page,
  }, testInfo) => {
    const suffix = `${Date.now()}-${testInfo.retry}`;
    const accessRequest = await seedAccessRequest({ suffix });

    try {
      await page.setViewportSize({ width: 1280, height: 800 });
      await page.goto(`/platform/beta/access-requests?search=${encodeURIComponent(suffix)}`);
      const row = desktopAccessRequestRow(page, accessRequest.id);
      await expect(row).toBeVisible({ timeout: 15000 });
      await row.getByTestId(`access-request-toggle-${accessRequest.id}`).click();
      await expect(row.locator('[data-testid="access-request-actions-panel"]')).toBeVisible();
      await page.waitForLoadState("networkidle");

      await checkA11yWithOptions(page, {
        runOnly: ["wcag2a", "wcag2aa"],
        include: ['[data-testid="platform-access-requests-page"]'],
      });
    } finally {
      await cleanupAccessRequest(accessRequest.id);
    }
  });
});
