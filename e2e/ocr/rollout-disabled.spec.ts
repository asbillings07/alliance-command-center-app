import { test, expect } from "../shared/fixtures";
import { prisma } from "@/app/src/lib/prisma";
import { checkA11y } from "../shared/accessibility";

test.skip(process.env.OCR_ROLLOUT_OFF_TEST !== "1", "Separate local-only flag-off run");
for (const width of [320, 820, 1280]) {
  test(`OCR disabled hides entry points and rejects direct routes and API at ${width}px`, async ({ page, login, ownerScenario }) => {
    const { allianceId, email, password } = ownerScenario;
    const member = await prisma.allianceMember.create({ data: { allianceId, playerName: "Synthetic Member" } });
    const period = await prisma.metricPeriod.create({ data: { allianceId, name: "Synthetic OCR week" } });
    await page.setViewportSize({ width, height: 900 });
    await login({ email, password, displayName: "Owner" });
    await page.goto(`/alliances/${allianceId}/members/${member.id}`);
    await expect(page.getByRole("link", { name: "Try daily VS screenshot review" })).toHaveCount(0);
    await page.goto(`/alliances/${allianceId}/periods/${period.id}/import`);
    await expect(page.getByRole("link", { name: "Screenshots", exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Capture Evaluation Results", exact: true })).toBeVisible();
    await expect(page.getByLabel("Ranking screenshots", { exact: true })).toHaveCount(0);
    await expect(page.getByText(/Upload a (?:CSV )?spreadsheet/)).toBeVisible();
    for (const route of [`/alliances/${allianceId}/periods/${period.id}/import?method=screenshots`,
      `/alliances/${allianceId}/screenshots?scope=batch`, `/alliances/${allianceId}/screenshots?memberId=${member.id}`]) {
      await page.goto(route);
      await expect(page.getByRole("heading", { name: "Screenshot evaluation is unavailable", exact: true })).toBeVisible();
      await expect(page.getByText("Edit QA alliance name", { exact: true })).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await checkA11y(page);
    }
    const api = `/api/ocr-evaluation?allianceId=${allianceId}&scope=batch`;
    const read = await page.request.get(`${api}&kind=result&id=synthetic-missing`);
    expect(read.status()).toBe(400); expect((await read.json()).error).toContain("unavailable for this account");
    const upload = await page.request.post(api, { headers: { origin: new URL(page.url()).origin }, multipart: {
      screenshot: { name: "synthetic.png", mimeType: "image/png", buffer: Buffer.from("not dispatched") },
      requestId: crypto.randomUUID(), contextKey: "stale-context", consent: "true",
    } });
    expect(upload.status()).toBe(400); expect((await upload.json()).error).toContain("unavailable for this account");
    expect(await prisma.ocrEvaluationAttempt.count({ where: { allianceId } })).toBe(0);
    expect(await prisma.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
  });
}
