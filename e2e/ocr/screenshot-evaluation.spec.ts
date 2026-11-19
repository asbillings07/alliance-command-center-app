import sharp from "sharp";
import { formatPower } from "@/app/src/lib/formatPower";
import { OCR_PROCESSING_NOTICE } from "@/app/src/lib/ocr/consentPolicy";
import { rankingFixture } from "@/app/src/lib/ocr/testing/rankingFixture";
import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11y } from "../shared/accessibility";

// A separate CI job opts into a localhost-only fake provider. Never a claim of
// Google recognition accuracy, and never enabled in a hosted environment.
test.skip(process.env.OCR_EVAL_TEST_FIXTURE !== "1", "Requires the isolated OCR fixture job");

// Recognition regressions start with explicit synthetic account consent. The
// separate consent suite covers first-use UI, withdrawal and account isolation.
test.beforeEach(async ({ ownerScenario }) => {
  await prisma.ocrConsentDecision.create({ data: { userId: ownerScenario.userId, purpose: "PROCESSING", granted: true, noticeVersion: OCR_PROCESSING_NOTICE } });
});

for (const [width, role] of [[320, "LEADER"], [820, "ADMIN"], [1280, "OWNER"]] as const) {
  test(`${role} edits only the QA alliance name with confirmation and history at ${width}px`, async ({ page, login, ownerScenario }, testInfo) => {
    test.setTimeout(120000);
    const { allianceId, userId, email, password } = ownerScenario;
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role } });
    await prisma.alliance.update({ where: { id: allianceId }, data: { name: "QA", server: allianceId } });
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Owner" });
    await page.goto(`/alliances/${allianceId}/screenshots?scope=batch`);
    await page.getByText("Edit QA alliance name", { exact: true }).click();
    await page.getByLabel("QA alliance name", { exact: true }).fill("[QA] Synthetic");
    await page.getByRole("button", { name: "Review QA name change", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Change this QA alliance name?", exact: true });
    await expect(dialog).toContainText("Historical scans and their original names remain unchanged");
    await checkA11y(page);
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    expect((await prisma.alliance.findUniqueOrThrow({ where: { id: allianceId } })).name).toBe("QA");
    expect(await prisma.ocrQaAllianceNameChange.count({ where: { allianceId } })).toBe(0);
    await page.getByRole("button", { name: "Review QA name change", exact: true }).click();
    await dialog.getByRole("button", { name: "Save QA name", exact: true }).click();
    await expect(page.getByText(`Capturing for [QA] Synthetic · Server ${allianceId}`, { exact: true })).toBeVisible();
    await page.getByText("Edit QA alliance name", { exact: true }).click();
    await expect(page.getByText("QA → [QA] Synthetic", { exact: true })).toBeVisible();
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(0);
    await checkA11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`ocr-qa-alliance-${width}.png`), fullPage: true });
    await page.getByLabel("Ranking screenshots", { exact: true }).setInputFiles({ name: "same-test-capture.png", mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture().svg)).png().toBuffer() });
    await page.getByRole("button", { name: "Read 1 screenshots", exact: true }).click();
    await expect(page.getByText(/3 unique rows/)).toBeVisible();
    const saved = await prisma.ocrEvaluationAttempt.findFirstOrThrow({ where: { allianceId } });
    expect(saved).toMatchObject({ allianceName: "[QA] Synthetic", status: "READY" });
    await page.getByLabel("QA alliance name", { exact: true }).fill("Different test alliance");
    await page.getByRole("button", { name: "Review QA name change", exact: true }).click();
    await dialog.getByRole("button", { name: "Save QA name", exact: true }).click();
    await expect(page.getByText(/0 unique rows/)).toBeVisible();
    expect(await prisma.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } })).toEqual(saved);
    expect(await prisma.ocrQaAllianceNameChange.count({ where: { allianceId } })).toBe(2);
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(1);
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "VIEWER" } });
    await page.reload();
    await expect(page.getByText("Edit QA alliance name", { exact: true })).toHaveCount(0);
  });
}

async function screenshot() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="588" height="780">
    <rect width="588" height="780" fill="#122039"/>
    <g fill="white" font-family="sans-serif"><text x="32" y="60" font-size="32">ALLIANCE DUEL</text>
    <text x="32" y="120" font-size="24">Today's Duel</text><text x="32" y="180" font-size="24">23:39:25</text>
    <text x="150" y="376" font-size="26">[TEST]Jordan Vale</text><text x="220" y="421" font-size="26">23,340,000</text>
    <text x="150" y="486" font-size="26">[TEST]Morgan Reed</text><text x="220" y="531" font-size="26">19,317,601</text>
    <text x="32" y="730" font-size="18">Synthetic local test fixture</text></g></svg>`;
  return { name: "synthetic-vs.png", mimeType: "image/png", buffer: await sharp(Buffer.from(svg)).png().toBuffer() };
}

// The personal screenshot experience requires an approved, linked member record.
async function grantOwnRecord(allianceId: string, memberId: string, userId: string) {
  const member = await prisma.allianceMember.update({ where: { id: memberId }, data: { userId }, include: { alliance: true } });
  const identity = await prisma.memberIdentityDecision.create({ data: {
    allianceId, memberId, confirmed: true, accountUserId: userId, playerName: member.playerName,
    allianceName: member.alliance.name, server: member.alliance.server, memberVersion: member.identityVersion,
    allianceVersion: member.alliance.identityVersion, actorUserId: userId, actorName: "QA reviewer", actorRole: "LEADER",
  } });
  const grant = { allianceId, memberId, accountUserId: userId, accountName: "QA account", playerName: member.playerName,
    identityDecisionId: identity.id, actorUserId: userId, actorName: "QA reviewer", actorRole: "LEADER" as const };
  await prisma.memberSelfAccessDecision.create({ data: { ...grant, granted: true } });
  return grant;
}

for (const width of [320, 820, 1280]) {
  test(`Member page opens alliance capture, personal record keeps private history at ${width}px`, async ({ page, login, ownerScenario }, testInfo) => {
    test.setTimeout(120000);
    const { allianceId, userId, email, password } = ownerScenario;
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "LEADER" } });
    await prisma.alliance.update({ where: { id: allianceId }, data: { name: "TEST", server: allianceId } });
    const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale" } });
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Leader" });
    await page.goto(`/alliances/${allianceId}/members/${member.id}`);
    const capture = `/alliances/${allianceId}/screenshots?scope=batch`;
    await page.getByRole("link", { name: "Upload ranking screenshots" }).click();
    await expect(page).toHaveURL(url => url.pathname + url.search === capture);
    await expect(page.getByLabel("Ranking screenshots", { exact: true })).toBeVisible();
    await page.goto(`/alliances/${allianceId}/screenshots?memberId=${member.id}`);
    await expect(page).toHaveURL(url => url.pathname + url.search === capture);
    await grantOwnRecord(allianceId, member.id, userId);
    await page.goto(`/alliances/${allianceId}/screenshots`);
    await expect(page.getByText("Synthetic test fixture", { exact: true })).toBeVisible();
    const upload = page.getByLabel("Screenshot", { exact: true });
    const scan = page.getByRole("button", { name: "Read screenshot", exact: true });
    await upload.setInputFiles(await screenshot());
    await expect.poll(() => page.getByRole("img", { name: "Selected daily VS screenshot" }).evaluate(el => (el as HTMLCanvasElement).width)).toBe(588);
    await expect(scan).toBeEnabled();
    await page.getByRole("button", { name: "Clear selection" }).click();
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(0);
    await upload.setInputFiles(await screenshot());
    await scan.click();
    await expect(page.getByText("Recognition is ready to review. No scores were changed.")).toBeVisible();
    await expect(page.getByText("23,340,000", { exact: true })).toBeVisible();
    await expect(page.getByText("Countdown visible · 23:39:25 · game date unconfirmed", { exact: true })).toBeVisible();
    await expect(page.getByText("Name candidate found — review needed", { exact: true })).toBeVisible();
    const image = page.getByRole("img", { name: "Daily VS screenshot being reviewed" });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(588);
    await checkA11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`ocr-review-${width}.png`), fullPage: true });
    const saved = await prisma.ocrEvaluationAttempt.findFirstOrThrow({ where: { allianceId } });
    expect(saved.actorRole).toBe("MEMBER");
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    const imageUrl = await image.getAttribute("src");
    const response = await page.request.get(imageUrl!);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    await page.reload();
    await page.getByRole("button", { name: "Review scan", exact: true }).click();
    await expect(page.getByText("23,340,000", { exact: true })).toBeVisible();
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(1);

    // Changing the verified identity requires a fresh grant before personal review.
    await prisma.allianceMember.update({ where: { id: member.id }, data: { playerName: "Different Player" } });
    const updatedGrant = await grantOwnRecord(allianceId, member.id, userId);
    await page.reload();
    await page.getByRole("button", { name: "Review scan", exact: true }).click();
    await expect(page.getByText("Name candidate in original review", { exact: true })).toBeVisible();
    await expect(page.getByText(/member identity or access context has changed since this scan/)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`ocr-historical-identity-${width}.png`), fullPage: true });
    await upload.setInputFiles(await screenshot());
    await scan.click();
    await expect(page.getByText("Matching name not found — blocked", { exact: true })).toBeVisible();
    await expect(page.getByText(/Use a screenshot that clearly shows your current in-game name/)).toBeVisible();
    await checkA11y(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`ocr-mismatch-${width}.png`), fullPage: true });

    await prisma.memberSelfAccessDecision.create({ data: { ...updatedGrant, granted: false } });
    expect((await page.request.get(imageUrl!)).status()).toBe(400);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Screenshot evaluation is unavailable" })).toBeVisible();
  });
}

test("member uses only an approved own record; revocation blocks retained content", async ({ page, browser, login, ownerScenario }, testInfo) => {
  test.setTimeout(120000);
  const { allianceId, userId, email, password } = ownerScenario;
  await prisma.alliance.update({ where: { id: allianceId }, data: { name: "TEST", server: allianceId } });
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const account = await prisma.user.create({ data: { email: `ocr-${crypto.randomUUID()}@example.test`, displayName: "Jordan Account", passwordHash: owner.passwordHash } });
  const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale", userId: account.id }, include: { alliance: true } });
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await login({ email, password, displayName: "Owner" });
    const memberPage = await context.newPage();
    await memberPage.goto("/login");
    await prisma.ocrConsentDecision.create({ data: { userId: account.id, purpose: "PROCESSING", granted: true, noticeVersion: OCR_PROCESSING_NOTICE } });
    await memberPage.locator('input[name="email"]').fill(account.email);
    await memberPage.locator('input[name="password"]').fill(password);
    await memberPage.getByRole("button", { name: "Sign In", exact: true }).click();
    await expect(memberPage).toHaveURL(/\/(app|alliances|create-alliance|redeem)/);
    const href = `/alliances/${allianceId}/screenshots`;
    await memberPage.goto(href);
    await expect(memberPage.getByRole("heading", { name: "Screenshot evaluation is unavailable" })).toBeVisible();
    const identity = await prisma.memberIdentityDecision.create({ data: { allianceId, memberId: member.id, confirmed: true,
      accountUserId: account.id, playerName: member.playerName, allianceName: member.alliance.name, server: member.alliance.server,
      memberVersion: member.identityVersion, allianceVersion: member.alliance.identityVersion,
      actorUserId: userId, actorName: owner.displayName, actorRole: "OWNER" } });
    const grant = { allianceId, memberId: member.id, accountUserId: account.id, accountName: account.displayName,
      playerName: member.playerName, identityDecisionId: identity.id, actorUserId: userId, actorName: owner.displayName, actorRole: "OWNER" as const };
    await prisma.memberSelfAccessDecision.create({ data: { ...grant, granted: true } });
    await memberPage.reload();
    await memberPage.getByLabel("Screenshot", { exact: true }).setInputFiles(await screenshot());
    await memberPage.getByRole("button", { name: "Read screenshot", exact: true }).click();
    await expect(memberPage.getByText("23,340,000", { exact: true })).toBeVisible();
    const imageUrl = await memberPage.getByRole("img", { name: "Daily VS screenshot being reviewed" }).getAttribute("src");
    expect((await memberPage.request.get(`${imageUrl}&memberId=${member.id}`)).status()).toBe(400);
    expect((await page.request.post("/api/ocr-evaluation", { headers: { origin: "https://untrusted.example" } })).status()).toBe(403);
    await prisma.memberSelfAccessDecision.create({ data: { ...grant, granted: false } });
    expect((await memberPage.request.get(imageUrl!)).status()).toBe(400);
    await memberPage.reload();
    await expect(memberPage.getByRole("heading", { name: "Screenshot evaluation is unavailable" })).toBeVisible();
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
  } finally {
    await context.close();
    await prisma.allianceMember.delete({ where: { id: member.id } });
    await prisma.user.delete({ where: { id: account.id } });
  }
});

test("rejects a disguised markup file without dispatching OCR", async ({ page, login, ownerScenario }) => {
  const { allianceId, email, password } = ownerScenario;
  const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale" } });
  await login({ email, password, displayName: "Owner" });
  await grantOwnRecord(allianceId, member.id, ownerScenario.userId);
  await page.goto(`/alliances/${allianceId}/screenshots`);
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.getByLabel("Screenshot", { exact: true }).setInputFiles(await screenshot());
  await expect.poll(() => page.getByRole("img", { name: "Selected daily VS screenshot" }).evaluate(el => (el as HTMLCanvasElement).width)).toBe(588);
  await page.getByLabel("Screenshot", { exact: true }).setInputFiles({ name: "disguised.png", mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><script>alert("unexpected execution")</script></svg>') });
  await expect(page.getByRole("img", { name: "Selected daily VS screenshot" })).toBeVisible();
  expect(await page.locator('img[src^="blob:"]').count()).toBe(0);
  await expect.poll(() => page.getByRole("img", { name: "Selected daily VS screenshot" }).evaluate(el => (el as HTMLCanvasElement).width)).toBe(1);
  await page.getByRole("button", { name: "Read screenshot", exact: true }).click();
  await expect(page.getByText("We could not read this image. Choose a complete PNG or JPEG screenshot up to 12 megapixels.")).toBeVisible();
  expect(dialogs).toEqual([]);
  expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(0);
});

for (const width of [320, 820, 1280]) {
  test(`Leader imports a ranking batch from the existing data page at ${width}px`, async ({ page, login, ownerScenario }, testInfo) => {
    test.setTimeout(120000);
    const { allianceId, userId, email, password } = ownerScenario;
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "LEADER" } });
    await prisma.alliance.update({ where: { id: allianceId }, data: { name: "QA", server: allianceId } });
    await prisma.allianceMember.createMany({ data: ["Jordan Vale", "Morgan Reed", "Riley Chen"].map(playerName => ({ allianceId, playerName })) });
    const period = await prisma.metricPeriod.create({ data: { allianceId, name: "Synthetic weekly review" } });
    const metric = await prisma.metric.create({ data: { allianceId, name: "Synthetic VS", type: "NUMERIC", observationGrain: "PERIOD_VALUE", memberPeriodRollup: "LATEST" } });
    await prisma.metricPeriodMetric.create({ data: { periodId: period.id, metricId: metric.id, weight: 1, required: false } });
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Leader" });
    await page.goto(`/alliances/${allianceId}`);
    await page.getByRole("link", { name: "Capture Evaluation Results", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/periods/${period.id}/import$`));
    await expect(page.getByLabel("Ranking screenshots", { exact: true })).toBeVisible();
    await page.getByRole("link", { name: "Spreadsheet", exact: true }).click();
    await expect(page).toHaveURL(/method=spreadsheet$/);
    await expect(page.getByLabel("Ranking screenshots", { exact: true })).toHaveCount(0);
    await page.getByRole("link", { name: "Screenshots", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Capture Evaluation Results", exact: true })).toBeVisible();
    const files = await Promise.all((["monday", "weekly"] as const).map(async kind => ({
      name: `${kind}.png`, mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture(kind).svg)).png().toBuffer(),
    })));
    await page.getByLabel("Ranking screenshots", { exact: true }).setInputFiles(files);
    const scan = page.getByRole("button", { name: "Read 2 screenshots", exact: true });
    await expect(scan).toBeEnabled();
    await scan.click();
    await expect(page.getByText(/Batch recognition is ready/)).toBeVisible();
    await expect(page.getByText("6 unique rows", { exact: false })).toBeVisible();
    await expect(page.getByText(/current game day is in progress/)).toHaveCount(0);
    const finish = page.getByRole("button", { name: "Finish recognition review" });
    await expect(finish).toBeDisabled();
    const week = page.getByLabel("Week beginning (Monday)");
    await week.fill("2026-11-17");
    await expect(page.getByRole("alert").filter({ hasText: "Choose a Monday" })).toBeVisible();
    await expect(finish).toBeDisabled();
    await week.fill("2026-11-16");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByText("Daily score · 2026-11-16", { exact: true })).toHaveCount(3);
    await expect(page.getByText("Weekly total · week of 2026-11-16", { exact: true })).toHaveCount(3);
    const row = page.getByRole("listitem").filter({has: page.getByRole("button", {name:"View source for Jordan Vale", exact:true})}).first();
    await row.getByRole("button", {name:"Exclude from review"}).click();
    const minimized = page.getByRole("listitem").filter({has:page.getByRole("button", {name:"Include in review"})});
    await expect(minimized).toContainText("Jordan Vale");
    await expect(minimized.getByRole("button", {name:/View source/})).toHaveCount(0);
    await week.fill("2026-11-23");
    await expect(minimized).toContainText("2026-11-23");
    await week.fill("2026-11-16");
    await minimized.getByRole("button", {name:"Include in review"}).click();
    await expect(page.getByRole("button", {name:"View source for Jordan Vale",exact:true})).toHaveCount(2);
    await finish.click();
    await expect(page.getByText(/^Recognition reviewed(?: · No scores saved)?$/)).toBeVisible();
    const previewTrigger = page.getByRole("button", { name: "View screenshot 1", exact: true });
    await previewTrigger.click();
    const preview = page.getByRole("dialog", { name: "Screenshot 1", exact: true });
    await expect(preview).toBeVisible();
    const closePreview = preview.getByRole("button", { name: "Close preview", exact: true });
    await expect(closePreview).toBeFocused();
    const image = page.getByRole("img", { name: "Original ranking screenshot for batch review" });
    await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(600);
    const imageUrl = (await image.getAttribute("src"))!;
    expect((await page.request.get(imageUrl)).headers()["cache-control"]).toBe("private, no-store");
    await checkA11y(page);
    const box = (await preview.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    const imageRegion = preview.getByRole("region", { name: "Screenshot image", exact: true });
    const fitWithinRegion = async () => {
      const regionBox = (await imageRegion.boundingBox())!;
      const imageBox = (await image.boundingBox())!;
      expect(imageBox.y).toBeGreaterThanOrEqual(regionBox.y);
      expect(imageBox.x).toBeGreaterThanOrEqual(regionBox.x);
      expect(imageBox.y + imageBox.height).toBeLessThanOrEqual(regionBox.y + regionBox.height);
      expect(imageBox.x + imageBox.width).toBeLessThanOrEqual(regionBox.x + regionBox.width);
    };
    await fitWithinRegion();
    if (width === 320) {
      for (const size of [{width:320,height:480},{width:568,height:320}]) {
        await page.setViewportSize(size); await fitWithinRegion();
        await expect(closePreview).toBeInViewport();
      }
      await page.setViewportSize({width,height:900});
    }
    await preview.getByRole("button", { name: "Enlarge image", exact: true }).click();
    expect(await imageRegion.evaluate(el => el.scrollHeight > el.clientHeight || el.scrollWidth > el.clientWidth)).toBe(true);
    await preview.getByRole("button", { name: "Fit image", exact: true }).click();
    await closePreview.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(preview.getByRole("region", { name: "Screenshot image" })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(closePreview).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`leader-batch-${width}.png`), fullPage: true });
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(previewTrigger).toBeFocused();
    await expect(page.getByText("Daily score · 2026-11-16", {exact:true})).toHaveCount(3);
    await expect(page.getByText(/^Recognition reviewed(?: · No scores saved)?$/)).toBeVisible();
    const memberSource = page.getByRole("button", { name: "View source for Jordan Vale", exact: true }).first();
    await memberSource.click();
    const memberPreview = page.getByRole("dialog", { name: "Source for Jordan Vale", exact: true });
    await expect(memberPreview).toBeVisible();
    await expect(memberPreview.getByRole("img")).toHaveAttribute("src", imageUrl);
    await memberPreview.getByRole("button", { name: "Close preview", exact: true }).click();
    await expect(memberPreview).toHaveCount(0);
    await expect(memberSource).toBeFocused();
    // An expired/private source error belongs inside the dialog; closing keeps the review.
    await page.route("**/api/ocr-evaluation?**kind=image", route => route.fulfill({ status: 400, body: "Unavailable" }));
    await previewTrigger.click();
    await expect(preview.getByRole("alert")).toContainText("This screenshot is unavailable");
    await preview.getByRole("button", { name: "Close preview", exact: true }).click();
    await page.unroute("**/api/ocr-evaluation?**kind=image");
    await expect(previewTrigger).toBeFocused();
    // Re-selecting a completed image reuses its scan instead of paying again.
    await page.getByLabel("Ranking screenshots", { exact: true }).setInputFiles(files[0]);
    await page.getByRole("button", { name: "Read 1 screenshots", exact: true }).click();
    await expect(page.getByText(/Batch recognition is ready/)).toBeVisible();
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(2);
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    await page.reload();
    const retained = page.getByRole("button", { name: "Add scan to review" });
    await expect(retained).toHaveCount(2);
    await retained.first().click();
    await page.getByLabel("Week beginning (Monday)").fill("2026-11-16");
    await expect(finish).toBeEnabled();
    await week.fill("2026-11-23");
    await expect(finish).toBeEnabled();
    await retained.click();
    await expect(page.getByText("Daily score · 2026-11-23", {exact:true})).toHaveCount(3);
    await expect(page.getByText("Weekly total · week of 2026-11-23", {exact:true})).toHaveCount(3);
    await expect(finish).toBeEnabled();
    // Historical READY is not a bypass after the configured alliance changes.
    await prisma.alliance.update({ where: { id: allianceId }, data: { name: "Different Alliance" } });
    expect((await page.request.get(imageUrl)).status()).toBe(400);
    await page.reload();
    await page.getByRole("button", { name: "Add scan to review" }).first().click();
    await expect(page.getByRole("dialog", { name: "No screenshots match your alliance" })).toBeVisible();
    await page.getByRole("button", { name: "Back to screenshots", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("does not match the alliance");
    await expect(page.getByRole("button", { name: /View screenshot/ })).toHaveCount(0);
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "VIEWER" } });
    expect((await page.request.get(imageUrl)).status()).toBe(400);
  });
}

for (const [width, role] of [[320, "OWNER"], [820, "ADMIN"], [1280, "LEADER"]] as const) {
  test(`${role} sees every rejected image and an all-mismatch modal at ${width}px`, async ({ page, login, ownerScenario }) => {
    test.setTimeout(120000);
    const { allianceId, userId, email, password } = ownerScenario;
    await prisma.alliance.update({ where: { id: allianceId }, data: { name: "Different Alliance", server: allianceId } });
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role } });
    await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale" } });
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: role });
    await page.goto(`/alliances/${allianceId}/screenshots?scope=batch`);
    const files = await Promise.all((["monday", "weekly"] as const).map(async kind => ({
      name: `${kind}.png`, mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture(kind).svg)).png().toBuffer(),
    })));
    const upload = page.getByLabel("Ranking screenshots", { exact: true });
    await upload.setInputFiles(files);
    await page.getByRole("button", { name: "Read 2 screenshots", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "No screenshots match your alliance", exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("None of the 2 selected screenshots match");
    const close = dialog.getByRole("button", { name: "Back to screenshots" });
    await expect(close).toBeFocused(); await close.press("Tab"); await expect(close).toBeFocused();
    await close.press("Shift+Tab"); await expect(close).toBeFocused();
    await checkA11y(page);
    const bounds = await dialog.boundingBox(); expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
    await close.press("Escape"); await expect(dialog).toHaveCount(0); await expect(upload).toBeFocused();
    for (const index of [1, 2]) await expect(page.getByRole("listitem", { name: `Screenshot ${index}`, exact: true })).toContainText("This screenshot does not match the alliance");
    await expect(page.getByText("Queued", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /View screenshot/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Retry scan" })).toHaveCount(0);
    const attempt = await prisma.ocrEvaluationAttempt.findFirstOrThrow({ where: { allianceId } });
    expect(attempt).toMatchObject({ status: "FAILED", outcome: "alliance-mismatch" });
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(2);
    const sourceUrl = `/api/ocr-evaluation?allianceId=${allianceId}&scope=batch&id=${attempt.id}&kind=image`;
    const rejected = await page.request.get(sourceUrl); expect(rejected.status()).toBe(400);
    expect(await rejected.json()).toMatchObject({ outcome: "alliance-mismatch" });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("button", { name: "Clear review", exact: true }).click();
    await upload.setInputFiles(files[0]);
    await page.getByRole("button", { name: "Read 1 screenshots", exact: true }).click();
    await expect(dialog).toBeVisible(); await close.click(); await expect(dialog).toHaveCount(0);
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(2);
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
  });
}

for (const [width, role] of [[320, "LEADER"], [820, "OWNER"], [1280, "ADMIN"]] as const) {
  test(`${role} keeps matching images and marks every mismatch without a modal at ${width}px`, async ({ page, login, ownerScenario }) => {
    test.setTimeout(120000);
    const { allianceId, userId, email, password } = ownerScenario;
    await prisma.alliance.update({ where: { id: allianceId }, data: { name: "QA", server: allianceId } });
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role } });
    await prisma.allianceMember.createMany({ data: ["Jordan Vale", "Morgan Reed", "Riley Chen"].map(playerName => ({ allianceId, playerName })) });
    await page.setViewportSize({ width, height: 900 }); await login({ email, password, displayName: role });
    await page.goto(`/alliances/${allianceId}/screenshots?scope=batch`);
    const foreign = async (kind: "monday" | "weekly") => ({ name: `foreign-${kind}.png`, mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture(kind, "[OTHER] Foreign").svg)).resize(602,900).png().toBuffer() });
    await page.getByLabel("Ranking screenshots", { exact: true }).setInputFiles([
      await foreign("monday"), { name: "matching.png", mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture().svg)).png().toBuffer() }, await foreign("weekly"),
    ]);
    await page.getByRole("button", { name: "Read 3 screenshots", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("Batch checked");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    for (const index of [1, 3]) await expect(page.getByRole("listitem", { name: `Screenshot ${index}`, exact: true })).toContainText("This screenshot does not match the alliance");
    await expect(page.getByRole("button", { name: "View screenshot 2", exact: true })).toBeVisible();
    await expect(page.getByText("3 unique rows", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Finish recognition review" })).toBeDisabled();
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(3);
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    await checkA11y(page); expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}

test("a processing failure after a mismatch stops dispatch without claiming the whole batch is foreign", async ({ page, login, ownerScenario }) => {
  test.setTimeout(120000);
  const { allianceId, email, password } = ownerScenario;
  await prisma.alliance.update({ where: { id: allianceId }, data: { name: "QA", server: allianceId } });
  await login({ email, password, displayName: "Owner" });
  await page.goto(`/alliances/${allianceId}/screenshots?scope=batch`);
  const unique = rankingFixture().svg.replace('</svg>', `<text x="10" y="850">${crypto.randomUUID()}</text></svg>`);
  await page.getByLabel("Ranking screenshots", { exact: true }).setInputFiles([
    { name: "foreign.png", mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture("monday", "[OTHER] Foreign").svg)).resize(602,900).png().toBuffer() },
    { name: "interruption.png", mimeType: "image/png", buffer: await sharp(Buffer.from(unique)).resize(601,900).png().toBuffer() },
    { name: "unstarted.png", mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture().svg)).png().toBuffer() },
  ]);
  await page.getByRole("button", { name: "Read 3 screenshots", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Stopped. Completed scans remain");
  await expect(page.getByRole("listitem", { name: "Screenshot 1", exact: true })).toContainText("Blocked — alliance check");
  await expect(page.getByRole("listitem", { name: "Screenshot 2", exact: true })).toContainText("Needs attention");
  await expect(page.getByRole("listitem", { name: "Screenshot 3", exact: true })).toContainText("Queued");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(2);
});

test("stopping a batch after a mismatch leaves the unstarted screenshot unclassified", async ({ page, login, ownerScenario }) => {
  test.setTimeout(120000);
  const { allianceId, email, password } = ownerScenario;
  await prisma.alliance.update({ where: { id: allianceId }, data: { name: "Different Alliance", server: allianceId } });
  await login({ email, password, displayName: "Owner" });
  await page.goto(`/alliances/${allianceId}/screenshots?scope=batch`);
  let release!: () => void; let responded!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const responseReady = new Promise<void>(resolve => { responded = resolve; });
  await page.route("**/api/ocr-evaluation?**", async route => {
    if (route.request().method() !== "POST") { await route.continue(); return; }
    const response = await route.fetch(); responded(); await held; await route.fulfill({ response });
  });
  await page.getByLabel("Ranking screenshots", { exact: true }).setInputFiles(await Promise.all((["monday", "weekly"] as const).map(async kind => ({
    name: `${kind}.png`, mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture(kind).svg)).png().toBuffer(),
  }))));
  await page.getByRole("button", { name: "Read 2 screenshots", exact: true }).click();
  try { await responseReady; await page.getByRole("button", { name: "Stop after this image", exact: true }).click(); }
  finally { release(); }
  await expect(page.getByRole("status")).toContainText("Stopped. Completed scans remain");
  await expect(page.getByRole("listitem", { name: "Screenshot 1", exact: true })).toContainText("Blocked — alliance check");
  await expect(page.getByRole("listitem", { name: "Screenshot 2", exact: true })).toContainText("Queued");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(1);
});

test("failed batch scans require deliberate new-charge consent and preserve earlier attempts", async ({ page, login, ownerScenario }) => {
  test.setTimeout(120000);
  const {allianceId,email,password} = ownerScenario;
  await prisma.alliance.update({ where: { id: allianceId }, data: { name: "QA", server: allianceId } });
  await login({email,password,displayName:"Owner"});
  await prisma.allianceMember.createMany({data:["Jordan Vale","Morgan Reed","Riley Chen"].map(playerName=>({allianceId,playerName}))});
  await page.goto(`/alliances/${allianceId}/screenshots?scope=batch`);
  const uniqueSvg = rankingFixture().svg.replace('</svg>', `<text x="10" y="850">${crypto.randomUUID()}</text></svg>`);
  const file = {name:"synthetic-interruption.png",mimeType:"image/png",buffer:await sharp(Buffer.from(uniqueSvg)).resize(601,900).png().toBuffer()};
  const upload = page.getByLabel("Ranking screenshots",{exact:true});
  const scan = page.getByRole("button",{name:"Read 1 screenshots",exact:true});
  await upload.setInputFiles(file); await scan.click();
  await expect(page.getByText(/Stopped. Completed scans remain/)).toBeVisible();
  const failed = await prisma.ocrEvaluationAttempt.findFirstOrThrow({where:{allianceId}});
  expect(failed.status).toBe("FAILED");
  const card = page.getByRole("listitem",{name:"Screenshot 1",exact:true});
  await expect(card.getByRole("button",{name:"Retry scan",exact:true})).toBeVisible();
  await page.reload();
  // Add another file to the queue. Retrying from history must leave it queued.
  await upload.setInputFiles({name:"weekly.png",mimeType:"image/png",buffer:await sharp(Buffer.from(rankingFixture("weekly").svg)).png().toBuffer()});
  await expect(card).toContainText("Queued");
  const picker = page.waitForEvent("filechooser");
  await page.getByRole("button",{name:"Retry scan",exact:true}).click();
  await (await picker).setFiles(file);
  await expect.poll(()=>prisma.ocrEvaluationAttempt.count({where:{allianceId}})).toBe(2);
  await expect(page.getByText(/Screenshot retry complete/)).toBeVisible();
  expect(await prisma.ocrEvaluationAttempt.findUniqueOrThrow({where:{retryOf:failed.id}})).toMatchObject({status:"READY",retryOf:failed.id});
  await expect(card).toContainText("Queued");
  const successful = page.getByRole("listitem",{name:"Screenshot 2",exact:true});
  await expect(successful.getByRole("button",{name:"Retry scan"})).toHaveCount(0);
  await expect(page.getByRole("button",{name:"Retry scan",exact:true})).toHaveCount(0);
  await card.getByRole("button",{name:"Remove screenshot 1 from review",exact:true}).click();
  await page.getByLabel("Week beginning (Monday)").fill("2026-11-16");
  await page.getByRole("button",{name:"Finish recognition review"}).click();
  await expect(page.getByText(/^Recognition reviewed(?: · No scores saved)?$/)).toBeVisible();
  expect(await prisma.ocrEvaluationAttempt.findUniqueOrThrow({where:{id:failed.id}})).toMatchObject({status:"FAILED",retryOf:null});
});

// Browser timezone differs from the CI server's UTC timezone. Historical
// instants stay identical; each viewer gets the appropriate calendar date/DST.
for (const timezoneId of ["America/New_York", "Asia/Tokyo"]) {
  test.describe(`upload history in ${timezoneId}`, () => {
    test.use({ timezoneId, locale: "en-US" });
    test("formats retained timestamps locally without changing their stored instants", async ({ page, login, ownerScenario }) => {
      const { allianceId, userId, email, password } = ownerScenario;
      const instants = ["2026-11-19T02:30:00.000Z", "2026-07-01T02:30:00.000Z"];
      const ids: string[] = [];
      for (const value of instants) {
        const id = crypto.randomUUID(); ids.push(id);
        await prisma.ocrEvaluationAttempt.create({ data: {
          id, requestId: id, allianceId, actorUserId: userId, actorName: "Synthetic uploader", actorRole: "OWNER",
          playerName: "Alliance ranking capture", allianceName: "Synthetic", server: "956", contextKey: "synthetic-history",
          sourceDigest: id, processingVersion: "synthetic-history", imageBytes: 1, status: "FAILED", outcome: "synthetic-history",
          createdAt: new Date(value), expiresAt: new Date(new Date(value).getTime() + 30 * 24 * 60 * 60 * 1000),
        } });
      }
      const errors: string[] = [];
      page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
      await login({ email, password, displayName: "Owner" });
      await page.goto(`/alliances/${allianceId}/screenshots?scope=batch`);
      for (const value of instants) {
        const time = page.locator(`time[datetime="${value}"]`);
        const expected = new Intl.DateTimeFormat("en-US", {
          timeZone: timezoneId, year: "numeric", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
        }).format(new Date(value));
        await expect(time).toHaveText(expected);
        await expect(time).toHaveAttribute("title", timezoneId);
      }
      expect(errors.filter(message => /hydration|didn't match|did not match/i.test(message))).toEqual([]);
      const saved = await prisma.ocrEvaluationAttempt.findMany({ where: { id: { in: ids } }, orderBy: { createdAt: "desc" } });
      expect(saved.map(attempt => attempt.createdAt.toISOString())).toEqual(instants);
      // Preserve immutable, uniquely scoped rows in this disposable CI database.
    });
  });
}

test("a confirmed ranking batch persists under the correct members for a second leader", async ({ page, login, ownerScenario, leaderScenario }) => {
  test.setTimeout(120000);
  const { allianceId } = ownerScenario;
  await prisma.alliance.update({ where: { id: allianceId }, data: { name: "QA", server: allianceId } });
  await prisma.allianceMembership.create({ data: { allianceId, userId: leaderScenario.userId, role: "LEADER" } });
  const period = await prisma.metricPeriod.create({ data: { allianceId, name: "Batch QA", startsAt: new Date("2026-11-16"), endsAt: new Date("2026-11-22") } });
  const metric = await prisma.metric.create({ data: { allianceId, name: "Daily VS", type: "NUMERIC", observationGrain: "DAILY_OBSERVATION", memberPeriodRollup: "SUM" } });
  await prisma.metricPeriodMetric.create({ data: { periodId: period.id, metricId: metric.id, weight: 1, required: false } });
  const members = await Promise.all(["Jordan Vale", "Morgan Reed"].map(playerName => prisma.allianceMember.create({ data: { allianceId, playerName } })));
  await prisma.memberMetricEntry.create({ data: { allianceMemberId: members[0].id, metricId: metric.id, periodId: period.id, observationGrain: "DAILY_OBSERVATION", observedOn: new Date("2026-11-16"), value: 25000000 } });
  const path = `/alliances/${allianceId}/periods/${period.id}/import?method=screenshots`;
  try {
    await login({ ...ownerScenario, displayName: "Importer" });
    await page.goto(path);
    const file = { name: "monday.png", mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture("monday").svg)).png().toBuffer() };
    await page.getByLabel("Ranking screenshots", { exact: true }).setInputFiles(file);
    await page.getByRole("button",{ name: "Read 1 screenshots", exact: true }).click();
    await expect(page.getByText(/Batch recognition is ready/)).toBeVisible();
    await page.getByLabel("Week beginning (Monday)").fill("2026-11-16");
    await expect(page.locator("li").filter({has:page.getByRole("button",{name:"View source for Riley Chen"})})).toContainText("New roster member");
    await page.getByRole("button",{name:"Finish recognition review"}).click();
    await page.getByLabel("Daily score metric").selectOption(metric.id);
    await page.getByRole("button",{name:"Review score changes"}).click();
    const dialog = page.getByRole("dialog",{name:"Apply these scores?"});
    await expect(dialog).toContainText("25,000,000 → 23,340,000");
    const confirm = dialog.getByRole("button",{name:"Confirm and save scores"});
    await expect(confirm).toBeDisabled();
    await expect(dialog).toContainText("1 new roster member will be created");
    await dialog.getByRole("button",{name:"Cancel"}).click();
    expect(await prisma.ocrScoreBatch.count({where:{allianceId}})).toBe(0);
    expect(await prisma.allianceMember.count({where:{allianceId,playerName:"Riley Chen"}})).toBe(0);
    await page.getByRole("button",{name:"Review score changes"}).click();
    await dialog.getByRole("checkbox",{name:/lower scores/}).check();
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("checkbox",{name:/Create these roster members/}).check();
    await prisma.memberMetricEntry.create({ data: { allianceMemberId: members[0].id, metricId: metric.id, periodId: period.id, observationGrain: "DAILY_OBSERVATION", observedOn: new Date("2026-11-16"), value: 26000000 } });
    await confirm.click();
    await expect(dialog.getByRole("alert")).toContainText("changed");
    expect(await prisma.ocrScoreBatch.count({where:{allianceId}})).toBe(0);
    expect(await prisma.allianceMember.count({where:{allianceId,playerName:"Riley Chen"}})).toBe(0);
    await dialog.getByRole("button",{name:"Cancel"}).click();
    await page.getByRole("button",{name:"Review score changes"}).click();
    await expect(dialog).toContainText("26,000,000");
    await dialog.getByRole("checkbox",{name:/lower scores/}).check();
    await expect(confirm).toBeDisabled();
    await dialog.getByRole("checkbox",{name:/Create these roster members/}).check();
    await confirm.click();
    await expect(page.getByRole("heading",{name:"Saved score batches"})).toBeVisible();
    const entries = await prisma.memberMetricEntry.findMany({where:{ periodId:period.id, entryMethod:"OCR_SCREENSHOT" },orderBy:{value:"desc"}});
    const added = await prisma.allianceMember.findFirstOrThrow({where:{allianceId,playerName:"Riley Chen"}});
    expect(added.userId).toBeNull();
    members.push(added);
    expect(entries.map(e=>[e.allianceMemberId,e.value])).toEqual([[members[0].id,23340000],[members[1].id,19317601],[added.id,17512500]]);
    await page.reload();
    await expect(page.getByRole("heading",{name:"Saved score batches"})).toBeVisible();
    await page.context().clearCookies();
    await login({ ...leaderScenario, displayName:"Second leader" });
    for (const [i, entry] of entries.entries()) {
      await page.goto(`/alliances/${allianceId}/members/${members[i].id}?periodId=${period.id}`);
      await page.reload();
      await expect(page.getByText(formatPower(entry.value!), {exact:true}).first()).toBeVisible();
      await page.goto(`/alliances/${allianceId}/members/${members[i].id}/history?entryId=${entry.id}`);
      await page.reload();
      const details = page.getByRole("region",{name:"Entry details"});
      await expect(details).toContainText(entry.value!.toLocaleString("en-US"));
      await expect(details).toContainText("Ranking screenshot");
      await expect(details).toContainText("Source screenshot uploaded by");
    }
    expect(await prisma.ocrScoreBatch.count({where:{allianceId}})).toBe(1);
  } finally {
    await prisma.ocrScoreSource.deleteMany({ where: { entry: { periodId: period.id } } });
    await prisma.memberMetricEntry.deleteMany({ where: { periodId: period.id } });
    await prisma.ocrScoreBatch.deleteMany({ where: { allianceId } });
    await prisma.allianceMembership.deleteMany({ where: { allianceId, userId:leaderScenario.userId } });
  }
});

test("a leader starts on an empty dashboard and confirms screenshot setup in one save", async ({page, login, ownerScenario}) => {
  const {allianceId} = ownerScenario;
  await prisma.alliance.update({where:{id:allianceId},data:{name:"QA",server:allianceId}});
  try {
    await login({...ownerScenario,displayName:"Importer"});
    await page.goto(`/alliances/${allianceId}`);
    await page.getByRole("link",{name:"Capture Evaluation Results",exact:true}).click();
    const file = { name:"weekly.png", mimeType:"image/png", buffer:await sharp(Buffer.from(rankingFixture("weekly").svg)).png().toBuffer() };
    await page.getByLabel("Ranking screenshots",{exact:true}).setInputFiles(file);
    await page.getByRole("button",{name:"Read 1 screenshots"}).click();
    await expect(page.getByText(/Batch recognition is ready/)).toBeVisible();
    await page.getByLabel("Week beginning (Monday)").fill("2026-11-16");
    await page.getByRole("button",{name:"Finish recognition review"}).click();
    await page.getByRole("button",{name:"Review score changes"}).click();
    const dialog = page.getByRole("dialog",{name:"Apply these scores?"});
    await expect(dialog).toContainText("Create VS week of 2026-11-16");
    await expect(dialog).toContainText("Create and attach Weekly VS points");
    await dialog.getByRole("button",{name:"Cancel"}).click();
    expect(await prisma.metricPeriod.count({where:{allianceId}})).toBe(0);
    await page.getByRole("button",{name:"Review score changes"}).click();
    await dialog.getByRole("checkbox",{name:"Create these roster members and save their scores."}).check();
    await dialog.getByRole("button",{name:"Confirm and save scores"}).click();
    await expect.poll(() => prisma.ocrScoreBatch.count({where:{allianceId}})).toBe(1);
    await page.reload();
    await expect(page.getByRole("heading",{name:"Saved score batches"})).toBeVisible();
    expect(await prisma.metricPeriod.count({where:{allianceId}})).toBe(1);
  } finally {
    await prisma.ocrScoreSource.deleteMany({where:{entry:{allianceMember:{allianceId}}}});
    await prisma.memberMetricEntry.deleteMany({where:{allianceMember:{allianceId}}});
    await prisma.ocrScoreBatch.deleteMany({where:{allianceId}});
  }
});
