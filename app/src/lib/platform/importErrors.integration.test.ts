import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "../prisma";
import { getImportErrors, getRelatedScans } from "./importErrors";
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
      { ...base, id: ready, requestId: randomUUID(), retryOf: failed, status: "READY", clientBuild: "a123bc4" },
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
    const {rows} = await getImportErrors(filters);
    expect(rows).toHaveLength(2);
    expect(rows.find(r => r.source === "Scan record")?.reason).toContain("specific cause was not recorded");
    expect(JSON.stringify(rows)).not.toContain("private");
    expect((await getImportErrors({ ...filters, method: "spreadsheet" })).rows).toMatchObject([{ build: "123abcd", reason: "Password-protected workbook" }]);
    expect((await getImportErrors({ ...filters, page: 1 })).rows).toEqual([]);
  });
  it("links the successful retry only within the same account, alliance and member scope", async () => {
    const steps = await getRelatedScans("scan:" + failed, false);
    expect(steps).toHaveLength(2);
    expect(steps.find(s => s.key === "scan:" + ready)).toMatchObject({ action: "User retry", outcome: "Ready for review", scores: 0, build: "a123bc4" });
    expect(JSON.stringify(steps)).not.toContain("private");
    mocks.admin.mockRejectedValueOnce(Error("denied"));
    await expect(getRelatedScans("scan:" + failed, false)).rejects.toThrow("denied");
    mocks.admin.mockRejectedValueOnce(Error("denied"));
    await expect(getImportErrors(filters)).rejects.toThrow("denied");
  });
});
