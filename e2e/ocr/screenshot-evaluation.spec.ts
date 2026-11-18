import sharp from "sharp";
import { rankingFixture } from "@/app/src/lib/ocr/testing/rankingFixture";
import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11y } from "../shared/accessibility";

// A separate CI job opts into a localhost-only fake provider. Never a claim of
// Google recognition accuracy, and never enabled in a hosted environment.
test.skip(process.env.OCR_EVAL_TEST_FIXTURE !== "1", "Requires the isolated OCR fixture job");

async function screenshot() {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="588" height="780">
    <rect width="588" height="780" fill="#122039"/>
    <g fill="white" font-family="sans-serif"><text x="32" y="60" font-size="32">ALLIANCE DUEL</text>
    <text x="32" y="120" font-size="24">Today's Duel</text><text x="32" y="180" font-size="24">23:39:25</text>
    <text x="150" y="376" font-size="26">[TEST]Jordan Vale</text><text x="220" y="421" font-size="26">23,340,000</text>
    <text x="150" y="486" font-size="26">[OTHER]Morgan Reed</text><text x="220" y="531" font-size="26">19,317,601</text>
    <text x="32" y="730" font-size="18">Synthetic local test fixture</text></g></svg>`;
  return { name: "synthetic-vs.png", mimeType: "image/png", buffer: await sharp(Buffer.from(svg)).png().toBuffer() };
}

for (const width of [320, 820, 1280]) {
  test(`Leader screenshot review, private history and mismatch at ${width}px`, async ({ page, login, ownerScenario }, testInfo) => {
    test.setTimeout(120000);
    const { allianceId, userId, email, password } = ownerScenario;
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "LEADER" } });
    const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale" } });
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Leader" });
    await page.goto(`/alliances/${allianceId}/members/${member.id}`);
    await page.getByRole("link", { name: "Try daily VS screenshot review" }).click();
    await expect(page.getByText("Synthetic test fixture", { exact: true })).toBeVisible();
    const upload = page.getByLabel("Screenshot", { exact: true });
    const scan = page.getByRole("button", { name: "Read screenshot", exact: true });
    await upload.setInputFiles(await screenshot());
    await expect.poll(() => page.getByRole("img", { name: "Selected daily VS screenshot" }).evaluate(el => (el as HTMLCanvasElement).width)).toBe(588);
    await expect(scan).toBeDisabled();
    await page.getByRole("button", { name: "Clear selection" }).click();
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(0);
    await upload.setInputFiles(await screenshot());
    await page.getByRole("checkbox").check();
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
    expect(saved.actorRole).toBe("LEADER");
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    const imageUrl = await image.getAttribute("src");
    const response = await page.request.get(imageUrl!);
    expect(response.status()).toBe(200);
    expect(response.headers()["cache-control"]).toBe("private, no-store");
    await page.reload();
    await page.getByRole("button", { name: "Review scan", exact: true }).click();
    await expect(page.getByText("23,340,000", { exact: true })).toBeVisible();
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(1);

    // A fresh wrong-name capture remains review-only, with an explicit warning.
    await prisma.allianceMember.update({ where: { id: member.id }, data: { playerName: "Different Player" } });
    await page.reload();
    await page.getByRole("button", { name: "Review scan", exact: true }).click();
    await expect(page.getByText("Name candidate in original review", { exact: true })).toBeVisible();
    await expect(page.getByText(/member identity or access context has changed since this scan/)).toBeVisible();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`ocr-historical-identity-${width}.png`), fullPage: true });
    await upload.setInputFiles(await screenshot());
    await page.getByRole("checkbox").check();
    await scan.click();
    await expect(page.getByText("Matching name not found — blocked", { exact: true })).toBeVisible();
    await expect(page.getByText(/future leadership submission would require an explicit resolution/)).toBeVisible();
    await checkA11y(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: testInfo.outputPath(`ocr-mismatch-${width}.png`), fullPage: true });

    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "VIEWER" } });
    expect((await page.request.get(imageUrl!)).status()).toBe(400);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Screenshot evaluation is unavailable" })).toBeVisible();
  });
}

test("member uses only an approved own record; revocation blocks retained content", async ({ page, browser, login, ownerScenario }, testInfo) => {
  test.setTimeout(120000);
  const { allianceId, userId, email, password } = ownerScenario;
  const owner = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const account = await prisma.user.create({ data: { email: `ocr-${crypto.randomUUID()}@example.test`, displayName: "Jordan Account", passwordHash: owner.passwordHash } });
  const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale", userId: account.id }, include: { alliance: true } });
  const context = await browser.newContext({ baseURL: testInfo.project.use.baseURL });
  try {
    await login({ email, password, displayName: "Owner" });
    const memberPage = await context.newPage();
    await memberPage.goto("/login");
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
    await memberPage.getByRole("checkbox").check();
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
  await page.goto(`/alliances/${allianceId}/screenshots?memberId=${member.id}`);
  const dialogs: string[] = [];
  page.on("dialog", async dialog => { dialogs.push(dialog.message()); await dialog.dismiss(); });
  await page.getByLabel("Screenshot", { exact: true }).setInputFiles(await screenshot());
  await expect.poll(() => page.getByRole("img", { name: "Selected daily VS screenshot" }).evaluate(el => (el as HTMLCanvasElement).width)).toBe(588);
  await page.getByLabel("Screenshot", { exact: true }).setInputFiles({ name: "disguised.png", mimeType: "image/png",
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="500" height="700"><script>alert("unexpected execution")</script></svg>') });
  await expect(page.getByRole("img", { name: "Selected daily VS screenshot" })).toBeVisible();
  expect(await page.locator('img[src^="blob:"]').count()).toBe(0);
  await expect.poll(() => page.getByRole("img", { name: "Selected daily VS screenshot" }).evaluate(el => (el as HTMLCanvasElement).width)).toBe(1);
  await page.getByRole("checkbox").check();
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
    await prisma.allianceMember.createMany({ data: ["Jordan Vale", "Morgan Reed", "Riley Chen"].map(playerName => ({ allianceId, playerName })) });
    const period = await prisma.metricPeriod.create({ data: { allianceId, name: "Synthetic weekly review" } });
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Leader" });
    await page.goto(`/alliances/${allianceId}/periods/${period.id}/import`);
    await page.getByRole("link", { name: "Screenshots", exact: true }).click();
    const files = await Promise.all((["monday", "weekly"] as const).map(async kind => ({
      name: `${kind}.png`, mimeType: "image/png", buffer: await sharp(Buffer.from(rankingFixture(kind).svg)).png().toBuffer(),
    })));
    await page.getByLabel("Ranking screenshots", { exact: true }).setInputFiles(files);
    const scan = page.getByRole("button", { name: "Read 2 screenshots", exact: true });
    await expect(scan).toBeDisabled();
    await page.getByRole("checkbox", { name: /I can share these screenshots/ }).check();
    await scan.click();
    await expect(page.getByText(/Batch recognition is ready/)).toBeVisible();
    await expect(page.getByText("6 unique rows", { exact: false })).toBeVisible();
    await expect(page.getByText(/current game day is in progress/)).toHaveCount(0);
    const finish = page.getByRole("button", { name: "Finish recognition review" });
    await expect(finish).toBeDisabled();
    await page.getByLabel("Week beginning (Monday)").fill("2026-11-16");
    await page.getByRole("checkbox", { name: "I have checked the calendar context for these screenshots." }).check();
    await expect(page.getByText("Daily score · 2026-11-16", { exact: true })).toHaveCount(3);
    await expect(page.getByText("Weekly total · week of 2026-11-16", { exact: true })).toHaveCount(3);
    await finish.click();
    await expect(page.getByText("Recognition reviewed · No scores saved")).toBeVisible();
    await page.getByRole("button", { name: "View screenshot 1", exact: true }).click();
    const image = page.getByRole("img", { name: "Original ranking screenshot for batch review" });
    await expect.poll(() => image.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(600);
    const imageUrl = (await image.getAttribute("src"))!;
    expect((await page.request.get(imageUrl)).headers()["cache-control"]).toBe("private, no-store");
    await checkA11y(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`leader-batch-${width}.png`), fullPage: true });
    // Re-selecting a completed image reuses its scan instead of paying again.
    await page.getByLabel("Ranking screenshots", { exact: true }).setInputFiles(files[0]);
    await page.getByRole("checkbox", { name: /I can share these screenshots/ }).check();
    await page.getByRole("button", { name: "Read 1 screenshots", exact: true }).click();
    await expect(page.getByText(/Batch recognition is ready/)).toBeVisible();
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(2);
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    await page.reload();
    await expect(page.getByRole("button", { name: "Add scan to review" })).toHaveCount(2);
    await prisma.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId } }, data: { role: "VIEWER" } });
    expect((await page.request.get(imageUrl)).status()).toBe(400);
  });
}
