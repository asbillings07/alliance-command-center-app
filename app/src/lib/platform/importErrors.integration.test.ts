import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../prisma";
import { getImportLog, getRelatedScans } from "./importErrors";
import { reportImportError } from "../importDiagnostics/reportAction";

const mocks = vi.hoisted(() => ({ admin: vi.fn(), auth: vi.fn() }));
vi.mock("../auth", () => ({ auth: mocks.auth }));
vi.mock("../auth/requirePlatformAdmin", () => ({ requirePlatformAdmin: mocks.admin }));

const localDb = (() => { try { return ["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL ?? "").hostname); } catch { return false; } })();
describe.skipIf(process.env.INTEGRATION_DB !== "true" || !localDb || !!process.env.VERCEL_ENV)("Platform import errors", () => {
  const actor = randomUUID(), alliance = randomUUID(), other = randomUUID(), name = "Fixture " + alliance;
  const failed = randomUUID(), ready = randomUUID(), foreign = randomUUID(), request = randomUUID();
  const filters = { period: "all", method: "all", page: 0, alliance: name, snapshot: false } as const;
  beforeAll(async () => {
    await prisma.user.create({ data: { id: actor, email: actor + "@example.test", displayName: "QA operator" } });
    await prisma.alliance.create({ data: { id: alliance, name, server: alliance } });
    await prisma.allianceMembership.create({ data: { userId: actor, allianceId: alliance, role: "LEADER" } });
    mocks.auth.mockResolvedValue({ user: { id: actor } });
    const createdAt = new Date();
    const base = { allianceId: alliance, actorUserId: actor, actorName: "private actor snapshot", actorRole: "LEADER",
      playerName: "private player", allianceName: name, server: "1", contextKey: "private context", sourceFilename: "private.png",
      sourceDigest: randomUUID(), processingVersion: "test", imageBytes: 10, createdAt, expiresAt: new Date(createdAt.getTime() + 30 * 86400000) };
    await prisma.ocrEvaluationAttempt.createMany({ data: [
      { ...base, id: failed, requestId: request, status: "FAILED", outcome: "processing-failed:recognition" },
      { ...base, id: ready, createdAt: new Date(createdAt.getTime() + 1000), expiresAt: new Date(base.expiresAt.getTime() + 1000), requestId: randomUUID(), retryOf: failed, status: "READY", clientBuild: "a123bc4" },
      { ...base, id: foreign, requestId: randomUUID(), allianceId: other, status: "READY" },
    ] });
  });
  afterAll(async () => {
    await prisma.importErrorReport.deleteMany({ where: { actorId: actor } });
    // The disposable database retains the immutable OCR audit rows.
    await prisma.allianceMembership.deleteMany({ where: { userId: actor } });
    await prisma.alliance.deleteMany({ where: { id: alliance } });
    await prisma.user.deleteMany({ where: { id: actor } });
  });
  it("retains permitted coded reports, suppresses duplicate scan failures and filters before pagination", async () => {
    await reportImportError(alliance, "evaluation", "encrypted", "123abcd");
    await reportImportError(alliance, "screenshot", "scan_unconfirmed", undefined, request);
    await reportImportError(other, "evaluation", "encrypted");
    await reportImportError(alliance, "roster", "malformed");
    // A UI caller cannot store a filename as an error code.
    await reportImportError(alliance, "evaluation", "private.png" as "encrypted");
    expect(await prisma.importErrorReport.count({ where: { actorId: actor } })).toBe(2);
    const {rows} = await getImportLog(filters);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.source === "Scan record")?.reason).toContain("specific cause was not recorded");
    expect(JSON.stringify(rows)).not.toContain("private");
    expect((await getImportLog({ ...filters, method: "spreadsheet" })).rows).toMatchObject([{ build: "123abcd", reason: "Password-protected workbook" }]);
    expect((await getImportLog({ ...filters, page: 1 })).rows).toEqual([]);
  });
  it("shows recorded spreadsheet scores for the selected alliance and date before paginating", async () => {
    const period = await prisma.metricPeriod.create({ data: { allianceId: alliance, name: "Test week" } });
    const metric = await prisma.metric.create({ data: { allianceId: alliance, name: "Test points", type: "NUMERIC" } });
    const member = await prisma.allianceMember.create({ data: { allianceId: alliance, playerName: "private fixture" } });
    const slot = { metricId: metric.id, periodId: period.id };
    try {
      await prisma.metricPeriodMetric.create({ data: { ...slot, weight: 1, required: false } });
      const base = { ...slot, allianceMemberId: member.id, value: 10, enteredByUserId: actor, enteredByName: "QA operator", enteredByRole: "LEADER" } as const;
      const yesterday = new Date(Date.now() - 2 * 86400000);
      const entries = Array.from({length: 26}, (_, i) => ({
        ...base, id: randomUUID(), entryMethod: i % 2 ? "SPREADSHEET_MULTI_PERIOD" as const : "SPREADSHEET_SINGLE_PERIOD" as const,
        createdAt: new Date(Date.now() - 60000 - i * 1000),
      }));
      await prisma.memberMetricEntry.createMany({ data: [...entries,
        { ...base, entryMethod: "SPREADSHEET_SINGLE_PERIOD", createdAt: yesterday },
        { ...base, entryMethod: "MANUAL" }, { ...base, entryMethod: "OCR_SCREENSHOT" },
      ] });
      const query = { ...filters, activity: "all", method: "spreadsheet", period: "24h" } as const;
      const first = await getImportLog(query);
      const second = await getImportLog({ ...query, page: 1 });
      expect(first.more).toBe(true);
      const scores = [...first.rows, ...second.rows].filter(row => row.key.startsWith("entry:"));
      expect(scores.map(row => row.key)).toEqual(entries.map(row => "entry:" + row.id));
      expect(scores.every(row => row.account === "QA operator" && row.method === "Evaluation spreadsheet" && row.reason === "1 score confirmed")).toBe(true);
      expect((await getImportLog({...query, alliance: other})).rows).toEqual([]);
    } finally {
      await prisma.memberMetricEntry.deleteMany({where: slot});
      await prisma.metricPeriodMetric.deleteMany({where: slot});
      await prisma.metricPeriod.delete({where: {id: period.id}});
      await prisma.metric.delete({where: {id: metric.id}});
      await prisma.allianceMember.delete({where: {id: member.id}});
    }
  });
  it("links the successful retry only within the same account, alliance and member scope", async () => {
    const timeline = await getImportLog({ ...filters, activity: "all", method: "screenshot" });
    expect(timeline.rows.map(r => r.key)).toEqual(["scan:" + ready, "scan:" + failed]);
    expect(timeline.rows[0].reason).toBe("User retry · Ready for review");
    expect(timeline.rows[1].reason).toMatch(/failed/i);
    const steps = await getRelatedScans("scan:" + failed, false);
    expect(steps).toHaveLength(2);
    expect(steps.find(s => s.key === "scan:" + ready)).toMatchObject({ action: "User retry", outcome: "Ready for review", scores: 0, build: "a123bc4" });
    expect(JSON.stringify(steps)).not.toContain("private");
    mocks.admin.mockRejectedValueOnce(Error("denied"));
    await expect(getRelatedScans("scan:" + failed, false)).rejects.toThrow("denied");
    mocks.admin.mockRejectedValueOnce(Error("denied"));
    await expect(getImportLog(filters)).rejects.toThrow("denied");
  });
});
