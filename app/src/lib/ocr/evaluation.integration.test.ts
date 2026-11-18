import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { prisma as db } from "../prisma";
import { loadIdentityReview, decideMemberIdentity } from "../memberIdentity";
import { loadMemberAccessReview, decideMemberSelfAccess } from "../memberSelfAccess";
import { evaluateScreenshot, loadEvaluationContext, readEvaluationContent, type EvaluationTarget } from "./evaluation";
import { OCR_CAMPAIGN, OCR_RETENTION_MS } from "./config";
import type { OcrTransport } from "./provider";
import type { Recognition } from "./recognition";

const localDb = (() => { try { return ["localhost", "127.0.0.1"].includes(new URL(process.env.DATABASE_URL ?? "").hostname); } catch { return false; } })();
const enabled = process.env.INTEGRATION_DB === "true" && !process.env.VERCEL_ENV && localDb;
describe.skipIf(!enabled)("integration: managed OCR evaluation authority and resource limits", () => {
  let actorId: string, accountId: string, allianceId: string, memberId: string;
  let bytes: Buffer, objects: Map<string, Uint8Array>, transport: OcrTransport;
  const recognition: Recognition = { text: "ALLIANCE DUEL\nToday's Duel\n23:39:25\n[TEST]Jordan Vale\n23,340,000", words: [
    { text: "[TEST]Jordan Vale", x: 120, y: 200, width: 200, height: 24 }, { text: "23,340,000", x: 150, y: 240, width: 150, height: 24 },
  ] };
  const leader = (): EvaluationTarget => ({ allianceId, actorId, memberId });
  const member = (): EvaluationTarget => ({ allianceId, actorId: accountId, memberId: null });
  async function input(target = leader(), requestId = crypto.randomUUID()) {
    return { ...target, requestId, bytes, consent: true, contextKey: (await loadEvaluationContext(target)).contextKey };
  }
  async function approve() {
    await decideMemberIdentity({ allianceId, memberId, actorId, confirm: true, acknowledged: true,
      reviewKey: (await loadIdentityReview(allianceId, memberId, actorId)).reviewKey });
    await decideMemberSelfAccess({ allianceId, memberId, actorId, grant: true, acknowledged: true,
      reviewKey: (await loadMemberAccessReview(allianceId, memberId, actorId)).reviewKey });
  }
  beforeEach(async () => {
    vi.stubEnv("ACC_E2E_MODE", "1"); vi.stubEnv("OCR_EVAL_TEST_FIXTURE", "1"); vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", ""); vi.stubEnv("NEXT_PUBLIC_SENTRY_REPLAY", "false");
    // Only the explicitly enabled loopback test database. These are synthetic
    // fixtures, never a reset of a provider qualification or paid allowance.
    await db.$executeRawUnsafe('TRUNCATE TABLE "OcrEvaluationAttempt", "OcrEvaluationBudget"');
    await db.ocrEvaluationBudget.create({ data: { id: OCR_CAMPAIGN } });
    const suffix = crypto.randomUUID();
    actorId = (await db.user.create({ data: { email: `ocr-owner-${suffix}@example.test`, displayName: "Morgan Owner" } })).id;
    accountId = (await db.user.create({ data: { email: `ocr-member-${suffix}@example.test`, displayName: "Jordan Account" } })).id;
    allianceId = (await db.alliance.create({ data: { name: `OCR ${suffix}`, server: "956" } })).id;
    await db.allianceMembership.create({ data: { allianceId, userId: actorId, role: "LEADER" } });
    memberId = (await db.allianceMember.create({ data: { allianceId, playerName: "Jordan Vale", userId: accountId } })).id;
    bytes = await sharp({ create: { width: 500, height: 700, channels: 3, background: "#112233" } }).png().toBuffer();
    objects = new Map();
    transport = { preflight: vi.fn(async () => {}), put: vi.fn(async (name, content) => { objects.set(name, content); }),
      read: vi.fn(async name => { const value = objects.get(name); if (!value) throw new Error("missing"); return value; }), recognize: vi.fn(async () => recognition) };
  });
  afterEach(async () => {
    vi.unstubAllEnvs(); vi.restoreAllMocks();
    await db.allianceMember.deleteMany({ where: { allianceId } });
    await db.allianceMembership.deleteMany({ where: { allianceId } });
    await db.alliance.deleteMany({ where: { id: allianceId } });
    await db.user.deleteMany({ where: { id: { in: [actorId, accountId] } } });
  });
  it("allows a focused Leader trial without a linked target and writes no metrics", async () => {
    await db.allianceMember.update({ where: { id: memberId }, data: { userId: null } });
    const saved = await evaluateScreenshot(await input(), transport);
    expect(saved).toMatchObject({ status: "READY", actorName: "Morgan Owner", actorRole: "LEADER" });
    const row = await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(OCR_RETENTION_MS);
    expect(await db.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    expect(await db.ocrEvaluationBudget.findUnique({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ reservedMicros: 10000, attempts: 1 });
    expect(JSON.stringify(row)).not.toContain("23,340,000");
    expect(await readEvaluationContent(leader(), saved.id, "result", transport)).toMatchObject({ review: { score: 23340000, progress: "in-progress" } });
  });
  it("requires current identity plus explicit member grant; members cannot supply another target", async () => {
    await expect(input(member())).rejects.toThrow("review"); await approve();
    const saved = await evaluateScreenshot(await input(member()), transport);
    expect(saved.actorRole).toBe("MEMBER");
    await expect(loadEvaluationContext({ ...member(), memberId })).rejects.toThrow("permission");
    await expect(readEvaluationContent({ ...leader(), allianceId: "other" }, saved.id, "image", transport)).rejects.toThrow();
    await expect(readEvaluationContent({ ...member(), allianceId: "other" }, saved.id, "image", transport)).rejects.toThrow();
  });
  it("denies a Viewer and a stale identity before any provider operation", async () => {
    const proposed = await input();
    await db.allianceMember.update({ where: { id: memberId }, data: { playerName: "New name" } });
    await expect(evaluateScreenshot(proposed, transport)).rejects.toThrow("changed");
    expect(transport.preflight).not.toHaveBeenCalled();
    await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "VIEWER" } });
    await expect(input()).rejects.toThrow("permission");
  });
  it("replays a successful request without another reservation or paid request", async () => {
    const proposed = await input(); const first = await evaluateScreenshot(proposed, transport);
    const second = await evaluateScreenshot(proposed, transport);
    expect(second.id).toBe(first.id); expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect((await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).attempts).toBe(1);
    const changed = await sharp(bytes).negate().png().toBuffer();
    await expect(evaluateScreenshot({ ...proposed, bytes: changed }, transport)).rejects.toThrow("different review");
  });
  it("never redispatches or refunds a failed/uncertain recognition", async () => {
    const proposed = await input(); vi.mocked(transport.recognize).mockRejectedValue(new Error("private OCR response"));
    await expect(evaluateScreenshot(proposed, transport)).rejects.toThrow("did not complete");
    expect(await evaluateScreenshot(proposed, transport)).toMatchObject({ status: "FAILED" });
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect((await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).reservedMicros).toBe(10000);
  });
  it("does not disclose recognition when member approval is revoked during processing", async () => {
    await approve(); const proposed = await input(member());
    vi.mocked(transport.recognize).mockImplementation(async () => {
      await decideMemberSelfAccess({ allianceId, memberId, actorId, grant: false, acknowledged: true,
        reviewKey: (await loadMemberAccessReview(allianceId, memberId, actorId)).reviewKey });
      return recognition;
    });
    await expect(evaluateScreenshot(proposed, transport)).rejects.toThrow("review");
    const attempt = await db.ocrEvaluationAttempt.findFirstOrThrow();
    await expect(readEvaluationContent(member(), attempt.id, "image", transport)).rejects.toThrow("review");
    expect(objects.has(`${attempt.id}/recognition.json`)).toBe(false);
  });
  it("reauthorizes after storage read before disclosing an image", async () => {
    await approve(); const saved = await evaluateScreenshot(await input(member()), transport);
    vi.mocked(transport.read).mockImplementation(async name => {
      await decideMemberSelfAccess({ allianceId, memberId, actorId, grant: false, acknowledged: true,
        reviewKey: (await loadMemberAccessReview(allianceId, memberId, actorId)).reviewKey });
      return objects.get(name)!;
    });
    await expect(readEvaluationContent(member(), saved.id, "image", transport)).rejects.toThrow("review");
  });
  it("keeps audit immutable and blocks content at the exact 30-day boundary", async () => {
    const saved = await evaluateScreenshot(await input(), transport);
    await expect(db.ocrEvaluationAttempt.update({ where: { id: saved.id }, data: { actorName: "changed" } })).rejects.toThrow("immutable");
    await expect(db.ocrEvaluationAttempt.delete({ where: { id: saved.id } })).rejects.toThrow("immutable");
    vi.spyOn(Date, "now").mockReturnValue(new Date(saved.expiresAt).getTime());
    await expect(readEvaluationContent(leader(), saved.id, "result", transport)).rejects.toThrow("retention period");
    expect(transport.read).not.toHaveBeenCalled(); expect((await loadEvaluationContext(leader())).attempts).toHaveLength(1);
  });
  it("allows exactly one concurrent final budget reservation and cannot reset consumption", async () => {
    const first = await input(); const second = await input();
    await db.ocrEvaluationBudget.update({ where: { id: OCR_CAMPAIGN }, data: { reservedMicros: 4_990_000, attempts: 499 } });
    const results = await Promise.allSettled([evaluateScreenshot(first, transport), evaluateScreenshot(second, transport)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1); expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(await db.ocrEvaluationBudget.findUnique({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 500, reservedMicros: 5_000_000 });
    await expect(db.ocrEvaluationBudget.update({ where: { id: OCR_CAMPAIGN }, data: { attempts: 0 } })).rejects.toThrow("cannot be reset");
    await expect(db.ocrEvaluationBudget.delete({ where: { id: OCR_CAMPAIGN } })).rejects.toThrow("cannot be reset");
  });
  it("admits only one concurrent dispatch for the same upload reference", async () => {
    const proposed = await input();
    await Promise.allSettled([evaluateScreenshot(proposed, transport), evaluateScreenshot(proposed, transport)]);
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(await db.ocrEvaluationAttempt.count()).toBe(1);
  });
  it("requires consent and does not reserve budget on failed provider preflight", async () => {
    const proposed = await input();
    await expect(evaluateScreenshot({ ...proposed, consent: false }, transport)).rejects.toThrow("Confirm");
    vi.mocked(transport.preflight).mockRejectedValue(new Error("configuration"));
    await expect(evaluateScreenshot(proposed, transport)).rejects.toThrow();
    expect(transport.recognize).not.toHaveBeenCalled(); expect(await db.ocrEvaluationAttempt.count()).toBe(0);
  });
  it("stops an account at 20 attempts and still allows reading its prior results", async () => {
    const first = await evaluateScreenshot(await input(), transport);
    for (let i = 1; i < 20; i++) await evaluateScreenshot(await input(), transport);
    await expect(evaluateScreenshot(await input(), transport)).rejects.toThrow("daily evaluation limit");
    expect(transport.recognize).toHaveBeenCalledTimes(20);
    expect(await readEvaluationContent(leader(), first.id, "result", transport)).toMatchObject({ review: { score: 23340000 } });
  });
  it("stops before dispatch when storage is full and bounds retained-content reads", async () => {
    const saved = await evaluateScreenshot(await input(), transport);
    await db.ocrEvaluationBudget.update({ where: { id: OCR_CAMPAIGN }, data: { storedBytes: 500 * 1024 * 1024, reads: 5000 } });
    await expect(evaluateScreenshot(await input(), transport)).rejects.toThrow("budget");
    await expect(readEvaluationContent(leader(), saved.id, "image", transport)).rejects.toThrow("viewing limit");
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(transport.read).not.toHaveBeenCalled();
  });
  it("does not serve a retained image whose bytes differ from its audit digest", async () => {
    const saved = await evaluateScreenshot(await input(), transport);
    objects.set(`${saved.id}/source.png`, new Uint8Array([1, 2, 3]));
    await expect(readEvaluationContent(leader(), saved.id, "image", transport)).rejects.toThrow("could not be verified");
  });
  it("identifies the historical target when a leader reopens a scan after a rename", async () => {
    const saved = await evaluateScreenshot(await input(), transport);
    await db.allianceMember.update({ where: { id: memberId }, data: { playerName: "Changed Player" } });
    expect(await readEvaluationContent(leader(), saved.id, "result", transport)).toMatchObject({
      contextChanged: true, capturedTarget: { playerName: "Jordan Vale" }, review: { score: 23340000 },
    });
  });
});
