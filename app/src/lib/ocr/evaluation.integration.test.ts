import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import sharp from "sharp";
import { prisma as db } from "../prisma";
import { loadIdentityReview, decideMemberIdentity } from "../memberIdentity";
import { loadMemberAccessReview, decideMemberSelfAccess } from "../memberSelfAccess";
import { evaluateScreenshot, loadEvaluationContext, ocrEvaluationAvailable, readEvaluationContent, type EvaluationTarget } from "./evaluation";
import { reservePilotAllowance } from "./pilotAllowance";
import { reviewOrSaveBatch } from "./confirmedBatch";
import * as providerSelection from "./transport";
import * as rankingContext from "./rankingContext";
import * as productionPilot from "./productionPilot";
import * as flags from "../featureFlags/evaluateFeature";
import { decideOcrConsent, loadOcrConsent } from "./consent";
import { OCR_PROCESSING_NOTICE, OCR_QUALITY_NOTICE, qualitySourceEligible } from "./consentPolicy";
import { OCR_CAMPAIGN, OCR_CUSTOMER_RESOURCES, OCR_RETENTION_MS } from "./config";
import type { OcrTransport } from "./provider";
import { RecognitionFailure, recognitionFailureMessage } from "./recognitionFailure";
import type { Recognition } from "./recognition";
import { rankingFixture } from "./testing/rankingFixture";
import { loadQaAllianceSettings, renameQaAlliance } from "./qaAlliance";

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
    return { ...target, requestId, bytes, processingConsentId: (await loadOcrConsent(target.actorId)).processing!.id, contextKey: (await loadEvaluationContext(target)).contextKey };
  }
  async function approve() {
    await decideMemberIdentity({ allianceId, memberId, actorId, confirm: true, acknowledged: true,
      reviewKey: (await loadIdentityReview(allianceId, memberId, actorId)).reviewKey });
    await decideMemberSelfAccess({ allianceId, memberId, actorId, grant: true, acknowledged: true,
      reviewKey: (await loadMemberAccessReview(allianceId, memberId, actorId)).reviewKey });
  }
  it("shares the last cent between QA and production and refuses a replay", async () => {
    const id = crypto.randomUUID();
    expect(await reservePilotAllowance(id)).toBe(true);
    expect(await reservePilotAllowance(id)).toBe(false);
    await db.ocrEvaluationBudget.update({ where: { id: OCR_CAMPAIGN }, data: { reservedMicros: 4_990_000, attempts: 499 } });
    const qaInput = await input();
    await Promise.allSettled([
      reservePilotAllowance(crypto.randomUUID()),
      evaluateScreenshot(qaInput, transport),
    ]);
    const total = await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } });
    expect([total.attempts, total.reservedMicros]).toEqual([500, 5_000_000]);
    expect(await reservePilotAllowance(crypto.randomUUID())).toBe(false);
    await expect(evaluateScreenshot(await input(), transport)).rejects.toThrow();
  });

  beforeEach(async () => {
    vi.stubEnv("FEATURE_FLAG_TEST_OVERRIDES", '{"ocr-screenshot-evaluation":true}');
    vi.stubEnv("ACC_E2E_MODE", "1"); vi.stubEnv("OCR_EVAL_TEST_FIXTURE", "1"); vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", ""); vi.stubEnv("NEXT_PUBLIC_SENTRY_REPLAY", "false");
    // Only the explicitly enabled loopback test database. These are synthetic
    // fixtures, never a reset of a provider qualification or paid allowance.
    await db.$executeRawUnsafe('TRUNCATE TABLE "OcrScoreSource", "OcrEvaluationAttempt", "OcrEvaluationBudget"');
    await db.ocrEvaluationBudget.createMany({ data: [{ id: OCR_CAMPAIGN }, { id: OCR_CUSTOMER_RESOURCES }] });
    const suffix = crypto.randomUUID();
    actorId = (await db.user.create({ data: { email: `ocr-owner-${suffix}@example.test`, displayName: "Morgan Owner" } })).id;
    accountId = (await db.user.create({ data: { email: `ocr-member-${suffix}@example.test`, displayName: "Jordan Account" } })).id;
    for (const id of [actorId, accountId]) await decideOcrConsent(id, { purpose: "PROCESSING", granted: true, expectedId: null, noticeVersion: OCR_PROCESSING_NOTICE });
    allianceId = (await db.alliance.create({ data: { name: "TEST", server: `956-${suffix}` } })).id;
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
  async function changeProcessing(granted: boolean) {
    return decideOcrConsent(actorId, { purpose: "PROCESSING", granted, expectedId: (await loadOcrConsent(actorId)).processing?.id ?? null, noticeVersion: OCR_PROCESSING_NOTICE });
  }
  async function changeQuality(granted: boolean) {
    return decideOcrConsent(actorId, { purpose: "QUALITY_REVIEW", granted, expectedId: (await loadOcrConsent(actorId)).quality?.id ?? null, noticeVersion: OCR_QUALITY_NOTICE });
  }
  it("keeps first-use decisions account-scoped, explicit and safe against stale re-enabling", async () => {
    expect((await loadOcrConsent(actorId)).quality).toBeNull();
    const before = await loadOcrConsent(actorId);
    await changeQuality(false);
    expect((await loadOcrConsent(actorId)).quality).toBeNull();
    await changeProcessing(true);
    expect(await loadOcrConsent(actorId)).toEqual(before);
    await changeProcessing(false);
    await expect(decideOcrConsent(actorId, { purpose: "PROCESSING", granted: true, expectedId: before.processing!.id, noticeVersion: OCR_PROCESSING_NOTICE })).rejects.toThrow("another tab");
    expect((await loadOcrConsent(accountId)).processing!.granted).toBe(true);
    await expect(evaluateScreenshot(await input(), transport)).rejects.toThrow("Screenshots are disabled");
    expect(transport.preflight).not.toHaveBeenCalled();
    expect(await db.ocrEvaluationAttempt.count()).toBe(0);
    await changeProcessing(true);
    const saved = await evaluateScreenshot(await input(), transport);
    expect(await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ qualityConsentId: null, processingConsentId: (await loadOcrConsent(actorId)).processing!.id });
  });
  it("checks revocation after preflight before reserving or storing", async () => {
    const proposed = await input();
    vi.mocked(transport.preflight).mockImplementation(async () => { await changeProcessing(false); });
    await expect(evaluateScreenshot(proposed, transport)).rejects.toThrow("Screenshots are disabled");
    expect(transport.put).not.toHaveBeenCalled(); expect(transport.recognize).not.toHaveBeenCalled();
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ reservedMicros: 0, attempts: 0 });
  });
  it("stops recognition after revocation during source storage and preserves the charge/history", async () => {
    const put = transport.put;
    transport.put = vi.fn(async (name, bytes, type) => { await put(name, bytes, type); await changeProcessing(false); });
    await expect(evaluateScreenshot(await input(), transport)).rejects.toThrow("Screenshots are disabled");
    expect(transport.recognize).not.toHaveBeenCalled();
    expect(await db.ocrEvaluationAttempt.findFirstOrThrow()).toMatchObject({ status: "FAILED", outcome: "processing-failed:access-check" });
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ reservedMicros: 10000, attempts: 1 });
  });
  it("does not publish recognition results after consent changes while Google responds", async () => {
    transport.recognize = vi.fn(async () => { await changeProcessing(false); return recognition; });
    await expect(evaluateScreenshot(await input(), transport)).rejects.toThrow("Screenshots are disabled");
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect(await db.memberMetricEntry.count({ where: { allianceMemberId: memberId } })).toBe(0);
  });
  it("rechecks permission after local ranking analysis before writing recognition output", async () => {
    const analyze = rankingContext.readRankingContext;
    vi.spyOn(rankingContext, "readRankingContext").mockImplementation(async (bytes, recognition) => {
      const result = await analyze(bytes, recognition);
      await changeProcessing(false);
      return result;
    });
    await expect(evaluateScreenshot(await input(), transport)).rejects.toThrow("Screenshots are disabled");
    expect(transport.put).toHaveBeenCalledTimes(1);
    expect([...objects.keys()].some(key => key.endsWith("recognition.json"))).toBe(false);
    expect(await db.ocrEvaluationAttempt.findFirstOrThrow()).toMatchObject({ status: "FAILED", outcome: "processing-failed:access-check" });
  });
  it("revocation and re-enabling cannot resume an earlier in-flight review", async () => {
    const proposed = await input();
    vi.mocked(transport.preflight).mockImplementation(async () => { await changeProcessing(false); await changeProcessing(true); });
    await expect(evaluateScreenshot(proposed, transport)).rejects.toThrow("changed");
    expect(transport.put).not.toHaveBeenCalled(); expect(transport.recognize).not.toHaveBeenCalled();
    expect(await db.ocrEvaluationAttempt.count()).toBe(0);
  });
  it("does not disclose private content if consent is revoked while storage responds", async () => {
    const saved = await evaluateScreenshot(await input(), transport);
    const read = transport.read;
    transport.read = vi.fn(async (name, limit) => { const bytes = await read(name, limit); await changeProcessing(false); return bytes; });
    await expect(readEvaluationContent(leader(), saved.id, "result", transport)).rejects.toThrow("Screenshots are disabled");
    expect(await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ status: "READY" });
    expect((await loadEvaluationContext(leader())).attempts).toHaveLength(1);
  });
  it("captures quality permission only for future sources and withdrawal never revives old eligibility", async () => {
    const older = await evaluateScreenshot(await input(), transport);
    await changeQuality(true);
    const saved = await evaluateScreenshot(await input(), transport);
    const source = await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } });
    const oldSource = await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: older.id } });
    expect(qualitySourceEligible(await loadOcrConsent(actorId), oldSource)).toBe(false);
    expect(qualitySourceEligible(await loadOcrConsent(actorId), source)).toBe(true);
    await changeQuality(false);
    expect(qualitySourceEligible(await loadOcrConsent(actorId), source)).toBe(false);
    await changeQuality(true);
    expect(qualitySourceEligible(await loadOcrConsent(actorId), source)).toBe(false);
    expect(await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } })).toEqual(source);
    // Optional review off never prevents normal OCR access.
    await changeQuality(false);
    await expect(readEvaluationContent(leader(), saved.id, "result", transport)).resolves.toHaveProperty("recognition");
  });

  it("personal consent does not invalidate another authorized leader's retained scan", async () => {
    await db.allianceMembership.create({ data: { allianceId, userId: accountId, role: "LEADER" } });
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    const saved = await evaluateScreenshot(await input(batch), transport);
    const colleague = { ...batch, actorId: accountId };
    expect((await loadEvaluationContext(colleague)).contextKey).toBe((await loadEvaluationContext(batch)).contextKey);
    await expect(readEvaluationContent(colleague, saved.id, "result", transport)).resolves.toHaveProperty("contextChanged", false);
    await changeProcessing(false); await changeProcessing(true);
    await expect(readEvaluationContent(batch, saved.id, "result", transport)).resolves.toHaveProperty("contextChanged", false);
    // Legacy captures have no permission metadata, but normal authorized source
    // review still works. They are never retroactively eligible for quality audit.
    const captured = await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } });
    const legacy = await db.ocrEvaluationAttempt.create({ data: { ...captured, id: crypto.randomUUID(), requestId: crypto.randomUUID(), processingConsentId: null, qualityConsentId: null } });
    objects.set(`${legacy.id}/recognition.json`, objects.get(`${saved.id}/recognition.json`)!);
    await expect(readEvaluationContent(colleague, legacy.id, "result", transport)).resolves.toHaveProperty("contextChanged", false);
    expect(qualitySourceEligible(await loadOcrConsent(actorId), legacy)).toBe(false);
  });
  it("keeps personal withdrawal available when global scans are switched off", async () => {
    vi.stubEnv("VERCEL", "1"); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_TARGET_ENV", "acc-ocr-eval");
    vi.stubEnv("VERCEL_GIT_COMMIT_REF", "codex/ocr-account-consent"); vi.stubEnv("OCR_EVAL_ENABLED", "false");
    await changeProcessing(false);
    expect((await loadOcrConsent(actorId)).processing!.granted).toBe(false);
    await expect(ocrEvaluationAvailable(leader())).resolves.toBe(false);
    expect(await db.ocrEvaluationAttempt.count()).toBe(0);
    await changeQuality(true);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await loadOcrConsent(actorId)).quality?.granted).toBe(true);
    await changeQuality(false);
    expect((await loadOcrConsent(actorId)).quality?.granted).toBe(false);
    await expect(changeQuality(true)).rejects.toThrow("unavailable here");
    await expect(changeProcessing(true)).rejects.toThrow("unavailable here");
    await expect(loadOcrConsent(crypto.randomUUID())).rejects.toThrow("unavailable here");
  });

  it("disabled rollout rejects direct load, scan, read and QA edits without budget or history changes", async () => {
    const scanInput = await input();
    const saved = await evaluateScreenshot(scanInput, transport);
    const ledger = await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } });
    const history = await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } });
    vi.mocked(transport.recognize).mockClear(); vi.mocked(transport.read).mockClear(); vi.mocked(transport.put).mockClear(); vi.mocked(transport.preflight).mockClear();
    vi.stubEnv("FEATURE_FLAG_TEST_OVERRIDES", '{"ocr-screenshot-evaluation":false}');
    await expect(ocrEvaluationAvailable(leader())).resolves.toBe(false);
    await expect(loadEvaluationContext(leader())).rejects.toThrow("unavailable for this account");
    await expect(evaluateScreenshot({ ...scanInput, requestId: crypto.randomUUID() }, transport)).rejects.toThrow("unavailable for this account");
    await expect(readEvaluationContent(leader(), saved.id, "image", transport)).rejects.toThrow("unavailable for this account");
    await expect(loadQaAllianceSettings(allianceId, actorId)).rejects.toThrow("unavailable for this account");
    await expect(renameQaAlliance({ allianceId, actorId, name: "Changed", identityVersion: 0, acknowledged: true })).rejects.toThrow("unavailable for this account");
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toEqual(ledger);
    expect(await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } })).toEqual(history);
    for (const fn of [transport.preflight, transport.recognize, transport.read, transport.put]) expect(fn).not.toHaveBeenCalled();
    expect(await db.ocrQaAllianceNameChange.count({ where: { allianceId } })).toBe(0);
  });

  it("uses authorized DB identities to target one user within an alliance, without granting import access", async () => {
    const evaluate = vi.spyOn(flags, "evaluateFeature").mockImplementation(async (_key, context) =>
      context.userId === actorId && context.alliance?.id === allianceId);
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    await expect(ocrEvaluationAvailable(batch)).resolves.toBe(true);
    await approve();
    await expect(loadEvaluationContext(member())).rejects.toThrow("unavailable for this account");
    await db.allianceMembership.create({ data: { allianceId, userId: accountId, role: "LEADER" } });
    await expect(loadEvaluationContext({ ...batch, actorId: accountId })).rejects.toThrow("unavailable for this account");
    evaluate.mockClear();
    await expect(loadEvaluationContext({ ...batch, allianceId: "foreign-alliance" })).rejects.toThrow("permission");
    expect(evaluate).not.toHaveBeenCalled();
    await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "VIEWER" } });
    await expect(loadEvaluationContext(batch)).rejects.toThrow("permission");
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rechecks rollout after preflight before reserving or sending anything", async () => {
    const scanInput = await input();
    vi.mocked(transport.preflight).mockImplementation(async () => { vi.stubEnv("FEATURE_FLAG_TEST_OVERRIDES", '{"ocr-screenshot-evaluation":false}'); });
    await expect(evaluateScreenshot(scanInput, transport)).rejects.toThrow("unavailable for this account");
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 0, reservedMicros: 0 });
    expect(transport.put).not.toHaveBeenCalled(); expect(transport.recognize).not.toHaveBeenCalled();
  });

  it("stops before recognition when rollout turns off after storage, retaining the reservation and failed attempt", async () => {
    const scanInput = await input();
    vi.mocked(transport.put).mockImplementation(async () => { vi.stubEnv("FEATURE_FLAG_TEST_OVERRIDES", '{"ocr-screenshot-evaluation":false}'); });
    await expect(evaluateScreenshot(scanInput, transport)).rejects.toThrow("unavailable for this account");
    expect(transport.recognize).not.toHaveBeenCalled();
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 1, reservedMicros: 10000 });
    expect(await db.ocrEvaluationAttempt.findFirstOrThrow({ where: { allianceId } })).toMatchObject({ status: "FAILED", outcome: "processing-failed:access-check" });
  });

  it("does not disclose content when rollout turns off while storage responds", async () => {
    const saved = await evaluateScreenshot(await input(), transport);
    const originalRead = transport.read;
    transport.read = vi.fn(async (name, maxBytes) => {
      const result = await originalRead(name, maxBytes);
      vi.stubEnv("FEATURE_FLAG_TEST_OVERRIDES", '{"ocr-screenshot-evaluation":false}');
      return result;
    });
    await expect(readEvaluationContent(leader(), saved.id, "result", transport)).rejects.toThrow("unavailable for this account");
    expect(await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ status: "READY" });
  });

  it("a provider exception cannot reserve budget or dispatch OCR", async () => {
    const scanInput = await input();
    vi.spyOn(flags, "evaluateFeature").mockRejectedValue(new Error("provider failure"));
    await expect(evaluateScreenshot(scanInput, transport)).rejects.toThrow("unavailable for this account");
    expect(transport.preflight).not.toHaveBeenCalled(); expect(transport.recognize).not.toHaveBeenCalled();
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 0, reservedMicros: 0 });
  });

  it.each(["OWNER", "ADMIN", "LEADER"] as const)("%s QA rename preserves prior source history/budget, invalidates identity and permits a fresh review of the same file", async role => {
    await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role } });
    await approve();
    const oldInput = await input(); const original = await evaluateScreenshot(oldInput, transport);
    const before = await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: original.id } });
    const settings = await loadQaAllianceSettings(allianceId, actorId);
    await renameQaAlliance({ allianceId, actorId, name: "[TEST] Testing", identityVersion: settings.identityVersion, acknowledged: true });
    expect(await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: original.id } })).toEqual(before);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 1, reservedMicros: 10000 });
    await expect(loadEvaluationContext(member())).rejects.toThrow("identity and access");
    await expect(evaluateScreenshot(oldInput, transport)).rejects.toThrow("identity or access changed");
    await expect(readEvaluationContent(leader(), original.id, "result", transport)).rejects.toThrow("alliance identity changed");
    const current = await loadQaAllianceSettings(allianceId, actorId);
    expect(current.identityVersion).toBe(settings.identityVersion + 1);
    expect(current.history[0]).toMatchObject({ previousName: "TEST", name: "[TEST] Testing", actorName: "Morgan Owner" });
    const fresh = await evaluateScreenshot(await input(), transport);
    expect(fresh).toMatchObject({ status: "READY" }); expect(fresh.id).not.toBe(original.id);
    expect(transport.recognize).toHaveBeenCalledTimes(2);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 2, reservedMicros: 20000 });
    expect(await db.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    await expect(db.ocrQaAllianceNameChange.update({ where: { id: current.history[0].id }, data: { name: "Rewrite" } })).rejects.toThrow("immutable");
    await expect(db.ocrQaAllianceNameChange.delete({ where: { id: current.history[0].id } })).rejects.toThrow("immutable");
  });
  it("QA name editing rejects Viewers and cross-alliance actors", async () => {
    await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "VIEWER" } });
    for (const id of [actorId, accountId]) {
      await expect(loadQaAllianceSettings(allianceId, id)).rejects.toThrow("authorized importers");
      await expect(renameQaAlliance({ allianceId, actorId: id, name: "Changed", identityVersion: 0, acknowledged: true })).rejects.toThrow("authorized importers");
    }
    expect(await db.ocrQaAllianceNameChange.count({ where: { allianceId } })).toBe(0);
    expect((await db.alliance.findUniqueOrThrow({ where: { id: allianceId } })).name).toBe("TEST");
  });
  it("QA name editing rejects stale, unconfirmed and colliding changes atomically", async () => {
    await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "OWNER" } });
    const rename = { allianceId, actorId, name: "Changed", identityVersion: 0, acknowledged: true };
    await expect(renameQaAlliance({ ...rename, acknowledged: false })).rejects.toThrow("confirm");
    await expect(renameQaAlliance({ ...rename, identityVersion: 5 })).rejects.toThrow("changed");
    const alliance = await db.alliance.findUniqueOrThrow({ where: { id: allianceId } });
    const other = await db.alliance.create({ data: { name: "Duplicate", server: alliance.server } });
    try { await expect(renameQaAlliance({ ...rename, name: "Duplicate" })).rejects.toThrow("already uses"); }
    finally { await db.alliance.delete({ where: { id: other.id } }); }
    expect(await db.ocrQaAllianceNameChange.count({ where: { allianceId } })).toBe(0);
    expect(await db.alliance.findUniqueOrThrow({ where: { id: allianceId } })).toMatchObject({ name: "TEST", identityVersion: 0 });
    const result = await Promise.allSettled([renameQaAlliance(rename), renameQaAlliance({ ...rename, name: "Other change" })]);
    expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.ocrQaAllianceNameChange.count({ where: { allianceId } })).toBe(1);
  });
  it.each([false, true])("saves once under concurrent confirmation and replay (initially empty roster: %s)", async empty => {
    if (empty) await db.allianceMember.delete({ where: {id:memberId} });
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    await db.alliance.update({ where: { id: allianceId }, data: { name: "QA" } });
    const fixture = rankingFixture();
    bytes = await sharp(Buffer.from(fixture.svg)).png().toBuffer();
    vi.mocked(transport.recognize).mockResolvedValue(fixture.recognition);
    vi.spyOn(providerSelection, "evaluationTransport").mockResolvedValue(transport);
    const first = await evaluateScreenshot(await input(batch), transport);
    const period = await db.metricPeriod.create({ data: { allianceId, name:"Test period", startsAt:new Date("2026-11-16"), endsAt:new Date("2026-12-16") } });
    const metric = await db.metric.create({ data: { allianceId, name:"Daily VS", type:"NUMERIC", observationGrain:"DAILY_OBSERVATION", memberPeriodRollup:"SUM" } });
    await db.metricPeriodMetric.create({ data: { periodId:period.id, metricId:metric.id, weight:1, required:false } });
    const selection = { allianceId, periodId:period.id, dailyMetric:metric.id, weeklyMetric:"", attemptIds:[first.id], week:"2026-11-16", captureDate:"", excluded:empty ? [] : [first.id+":1",first.id+":2"] };
    try {
      const preview = await reviewOrSaveBatch(actorId,selection);
      const decision = { comparison:preview.comparison, lowerConfirmed:false, createMembersConfirmed:empty };
      if (empty) {
        expect(preview.comparisons.every(row => row.createMember)).toBe(true);
        await expect(reviewOrSaveBatch(actorId,selection,{...decision,createMembersConfirmed:false})).rejects.toThrow("Confirm the new roster members");
        expect(await db.allianceMember.count({where:{allianceId}})).toBe(0);
      }
      const parallel = await Promise.allSettled([reviewOrSaveBatch(actorId,selection,decision),reviewOrSaveBatch(actorId,selection,decision)]);
      expect(parallel.some(result => result.status === "fulfilled" && result.value.saved)).toBe(true);
      expect((await reviewOrSaveBatch(actorId,selection,decision)).saved).toBe(true);
      expect(await db.memberMetricEntry.count({ where:{periodId:period.id} })).toBe(empty ? 3 : 1);
      expect(await db.ocrScoreSource.count({ where:{attemptId:first.id} })).toBe(empty ? 3 : 1);
      if (empty) {
        const roster = await db.allianceMember.findMany({where:{allianceId},select:{playerName:true,userId:true},orderBy:{playerName:"asc"}});
        expect(roster).toEqual(["Jordan Vale","Morgan Reed","Riley Chen"].map(playerName=>({playerName,userId:null})));
      }
      await expect(reviewOrSaveBatch(actorId,{...selection,week:"2026-11-23"})).rejects.toThrow(empty ? "roster changed" : "already saved");
      await changeProcessing(false);
      await expect(reviewOrSaveBatch(actorId,selection,decision)).rejects.toThrow("disabled");
      await changeProcessing(true);
      await expect(reviewOrSaveBatch(accountId,selection)).rejects.toThrow("permission");
      vi.spyOn(Date, "now").mockReturnValue(Date.now()+OCR_RETENTION_MS+60000);
      await expect(reviewOrSaveBatch(actorId,selection)).rejects.toThrow("retention");
      expect(transport.recognize).toHaveBeenCalledTimes(1);
    } finally {
      await db.ocrScoreSource.deleteMany({where:{attemptId:first.id}});
      await db.memberMetricEntry.deleteMany({where:{periodId:period.id}});
      await db.ocrScoreBatch.deleteMany({where:{periodId:period.id}});
      await db.metricPeriodMetric.deleteMany({where:{periodId:period.id}});
      await db.metricPeriod.delete({where:{id:period.id}});
      await db.metric.delete({where:{id:metric.id}});
    }
  });
  it("bootstraps a blank alliance on confirmation, then safely replays the receipt", async () => {
    await db.allianceMember.delete({where:{id:memberId}});
    await db.alliance.update({where:{id:allianceId},data:{name:"QA"}});
    const batch: EvaluationTarget = {allianceId,actorId,memberId:null,scope:"batch"};
    vi.spyOn(providerSelection,"evaluationTransport").mockResolvedValue(transport);
    const attemptIds = [];
    for (const kind of ["monday","weekly"] as const) {
      const fixture = rankingFixture(kind);
      bytes = await sharp(Buffer.from(fixture.svg)).png().toBuffer();
      vi.mocked(transport.recognize).mockResolvedValue(fixture.recognition);
      attemptIds.push((await evaluateScreenshot(await input(batch),transport)).id);
    }
    const selection = {allianceId,periodId:"auto",dailyMetric:"auto",weeklyMetric:"auto",attemptIds,week:"2026-11-16",captureDate:"",excluded:[]};
    try {
      const preview = await reviewOrSaveBatch(actorId,selection);
      expect(preview.changes).toHaveLength(3);
      expect(await db.metricPeriod.count({where:{allianceId}})).toBe(0);
      expect(await db.metric.count({where:{allianceId}})).toBe(0);
      const decision = {comparison:preview.comparison,lowerConfirmed:false,createMembersConfirmed:true};
      const saves = await Promise.allSettled([reviewOrSaveBatch(actorId,selection,decision),reviewOrSaveBatch(actorId,selection,decision)]);
      expect(saves.some(s=>s.status==="fulfilled" && s.value.saved)).toBe(true);
      const receipt = await reviewOrSaveBatch(actorId,selection,decision);
      expect(receipt.comparisons).toHaveLength(6);
      expect(await db.metricPeriod.count({where:{allianceId}})).toBe(1);
      expect(await db.metricPeriodMetric.count({where:{period:{allianceId},weight:0,required:false}})).toBe(2);
      expect(await db.memberMetricEntry.count({where:{periodId:receipt.periodId}})).toBe(6);
      expect(await db.metric.findMany({where:{allianceId},select:{observationGrain:true,memberPeriodRollup:true}})).toEqual(expect.arrayContaining([
        {observationGrain:"DAILY_OBSERVATION",memberPeriodRollup:"SUM"}, {observationGrain:"PERIOD_VALUE",memberPeriodRollup:"LATEST"}
      ]));
    } finally {
      await db.ocrScoreSource.deleteMany({where:{attemptId:{in:attemptIds}}});
      await db.memberMetricEntry.deleteMany({where:{allianceMember:{allianceId}}});
      await db.ocrScoreBatch.deleteMany({where:{allianceId}});
      await db.metricPeriodMetric.deleteMany({where:{period:{allianceId}}});
      await db.metric.deleteMany({where:{allianceId}});
      await db.metricPeriod.deleteMany({where:{allianceId}});
    }
  });
  it("reads a whole ranking capture once without member links or accepted metric writes", async () => {
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    await db.alliance.update({ where: { id: allianceId }, data: { name: "QA" } });
    const fixture = rankingFixture();
    bytes = await sharp(Buffer.from(fixture.svg)).png().toBuffer();
    vi.mocked(transport.recognize).mockResolvedValue(fixture.recognition);
    const first = await evaluateScreenshot(await input(batch), transport);
    const duplicate = await evaluateScreenshot(await input(batch), transport);
    expect(duplicate.id).toBe(first.id);
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: first.id } })).toMatchObject({ memberId: null, actorRole: "LEADER" });
    expect(await readEvaluationContent(batch, first.id, "result", transport)).toMatchObject({
      batchReview: { context: { kind: "daily", weekday: 1 }, rows: [
        { sourceName: "Jordan Vale", status: "exact", value: 23340000 },
        { sourceName: "Morgan Reed", status: "unmatched" }, { sourceName: "Riley Chen", status: "unmatched" },
      ] },
    });
    await approve();
    await expect(readEvaluationContent(member(), first.id, "image", transport)).rejects.toThrow("not available");
    await expect(loadEvaluationContext({ ...member(), scope: "batch" })).rejects.toThrow("permission");
    await expect(loadEvaluationContext({ ...batch, memberId })).rejects.toThrow("either");
    expect(await db.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 1, reservedMicros: 10000 });
  });
  it.each(["mismatch", "mixed", "missing"])("blocks %s alliance evidence despite an exact roster name and cannot retry it", async outcome => {
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    await db.alliance.update({ where: { id: allianceId }, data: { name: "QA" } });
    const fixture = rankingFixture();
    bytes = await sharp(Buffer.from(fixture.svg)).png().toBuffer();
    let i = 0;
    const words = fixture.recognition.words.flatMap(w => {
      if (!w.text.startsWith("[")) return [w];
      return outcome === "missing" ? [] : [{ ...w, text: outcome === "mismatch" || i++ === 1 ? "[OTHER] Foreign" : w.text }];
    });
    vi.mocked(transport.recognize).mockResolvedValue({ ...fixture.recognition, words });
    const first = await evaluateScreenshot(await input(batch), transport);
    expect(first).toMatchObject({ status: "FAILED", outcome: `alliance-${outcome}` });
    expect((await evaluateScreenshot(await input(batch), transport)).id).toBe(first.id);
    await expect(evaluateScreenshot({ ...await input(batch), retryOf: first.id }, transport)).rejects.toThrow(/unavailable for retry/);
    for (const kind of ["result", "image"] as const) {
      await expect(readEvaluationContent(batch, first.id, kind, transport)).rejects.toThrow("No results were added");
    }
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(transport.read).not.toHaveBeenCalled();
    expect(objects.has(`${first.id}/recognition.json`)).toBe(true);
    expect(await db.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 1, reservedMicros: 10000 });
  });
  it("also enforces the source alliance on the individual leader route", async () => {
    vi.mocked(transport.recognize).mockResolvedValue({ ...recognition, words: recognition.words.map(w => ({ ...w, text: w.text.replace("[TEST]", "[OTHER]") })) });
    expect(await evaluateScreenshot(await input(), transport)).toMatchObject({ status: "FAILED", outcome: "alliance-mismatch" });
  });
  it("rejects an untagged Duel row even when another row has the same player name", async () => {
    vi.mocked(transport.recognize).mockResolvedValue({ ...recognition, words: [...recognition.words,
      { text: "Jordan Vale", x: 120, y: 300, width: 200, height: 24 },
      { text: "19,317,601", x: 150, y: 340, width: 150, height: 24 },
    ] });
    expect(await evaluateScreenshot(await input(), transport)).toMatchObject({ status: "FAILED", outcome: "alliance-missing" });
  });
  it("a Leader cannot bypass source checks through an approved own-record route", async () => {
    await db.allianceMembership.create({ data: { allianceId, userId: accountId, role: "LEADER" } });
    await approve();
    const wrong = { ...recognition, words: recognition.words.map(w => ({ ...w, text: w.text.replace("[TEST]", "[OTHER]") })) };
    vi.mocked(transport.recognize).mockResolvedValueOnce(wrong);
    const rejected = await evaluateScreenshot(await input(member()), transport);
    expect(rejected).toMatchObject({ actorRole: "MEMBER", status: "FAILED", outcome: "alliance-mismatch" });
    await expect(readEvaluationContent(member(), rejected.id, "image", transport)).rejects.toThrow("does not match the alliance");
    const saved = await evaluateScreenshot(await input(member()), transport);
    expect(saved.status).toBe("READY");
    const path = `${saved.id}/recognition.json`;
    const legacy = JSON.parse(Buffer.from(objects.get(path)!).toString());
    legacy.words = wrong.words;
    objects.set(path, Buffer.from(JSON.stringify(legacy)));
    for (const kind of ["result", "image"] as const) {
      await expect(readEvaluationContent(member(), saved.id, kind, transport)).rejects.toThrow("does not match the alliance");
    }
    expect(transport.read).not.toHaveBeenCalledWith(`${saved.id}/source.png`, expect.anything());
    expect(await db.memberMetricEntry.count({ where: { allianceMember: { allianceId } } })).toBe(0);
  });
  it("reauthorizes older READY source evidence for both results and direct image requests", async () => {
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    const saved = await evaluateScreenshot(await input(batch), transport);
    const path = `${saved.id}/recognition.json`;
    const legacy = JSON.parse(Buffer.from(objects.get(path)!).toString());
    legacy.words[0].text = "[OTHER]Jordan Vale";
    // Model a retained pre-policy READY response, without rewriting its audit.
    objects.set(path, Buffer.from(JSON.stringify(legacy)));
    for (const kind of ["result", "image"] as const) {
      await expect(readEvaluationContent(batch, saved.id, kind, transport)).rejects.toThrow("does not match the alliance");
    }
    expect(transport.read).not.toHaveBeenCalledWith(`${saved.id}/source.png`, expect.anything());
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(await db.ocrEvaluationAttempt.findUniqueOrThrow({ where: { id: saved.id } })).toMatchObject({ status: "READY", outcome: "recognition-ready" });
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 1, reservedMicros: 10000 });
  });
  it("blocks a changed alliance identity while a source read is in flight", async () => {
    const saved = await evaluateScreenshot(await input(), transport);
    vi.mocked(transport.read).mockImplementation(async name => {
      if (name.endsWith("source.png")) await db.alliance.update({ where: { id: allianceId }, data: { server: "changed-server" } });
      return objects.get(name)!;
    });
    await expect(readEvaluationContent(leader(), saved.id, "image", transport)).rejects.toThrow("alliance identity changed");
  });
  it("denies an account outside the alliance before any provider operation", async () => {
    await db.allianceMembership.delete({ where: { allianceId_userId: { allianceId, userId: actorId } } });
    await expect(evaluateScreenshot({ allianceId, actorId, memberId: null, scope: "batch", requestId: crypto.randomUUID(), contextKey: "forged", processingConsentId: (await loadOcrConsent(actorId)).processing!.id, bytes }, transport)).rejects.toThrow("permission");
    expect(transport.preflight).not.toHaveBeenCalled();
    expect(transport.recognize).not.toHaveBeenCalled();
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 0, reservedMicros: 0 });
  });
  it("requires an unchanged batch roster before spending and rechecks Leader access after storage", async () => {
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    const proposed = await input(batch);
    await db.allianceMember.update({ where: { id: memberId }, data: { playerName: "New name" } });
    await expect(evaluateScreenshot(proposed, transport)).rejects.toThrow("changed");
    expect(transport.preflight).not.toHaveBeenCalled();
    const first = await evaluateScreenshot(await input(batch), transport);
    vi.mocked(transport.read).mockImplementation(async name => {
      await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "VIEWER" } });
      return objects.get(name)!;
    });
    await expect(readEvaluationContent(batch, first.id, "image", transport)).rejects.toThrow("permission");
  });
  it.each(["batch", "member"] as const)("links one %s retry, groups history and never reschedules on replay", async scope => {
    const target: EvaluationTarget = scope === "batch" ? { allianceId, actorId, memberId: null, scope } : leader();
    vi.mocked(transport.recognize).mockRejectedValue(new RecognitionFailure("provider-temporary"));
    const original = await input(target);
    const first = await evaluateScreenshot(original, transport);
    expect(first).toMatchObject({ status: "FAILED", retryOnce: true });
    expect(await evaluateScreenshot(original, transport)).not.toHaveProperty("retryOnce");
    const retry = { ...original, requestId: crypto.randomUUID(), retryOf: first.id, automaticRetry: true };
    const second = await evaluateScreenshot(retry, transport);
    expect(second).toMatchObject({ status: "FAILED", retryOf: first.id });
    expect(second).not.toHaveProperty("retryOnce");
    expect((await evaluateScreenshot(original, transport)).id).toBe(second.id);
    expect((await evaluateScreenshot({ ...retry, requestId: crypto.randomUUID() }, transport)).id).toBe(second.id);
    await expect(evaluateScreenshot({ ...retry, requestId: crypto.randomUUID(), retryOf: second.id }, transport)).rejects.toThrow("unavailable for automatic retry");
    expect((await loadEvaluationContext(target)).attempts).toMatchObject([{ id: second.id, firstAttemptAt: first.createdAt }]);
    expect(transport.recognize).toHaveBeenCalledTimes(2);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 2, reservedMicros: 20000 });
  });

  it("separates customer attempts from an exhausted test allowance, including a successful retry", async () => {
    vi.spyOn(productionPilot, "usesOcrTestAllowance").mockReturnValue(false);
    await db.ocrEvaluationBudget.update({ where: { id: OCR_CAMPAIGN }, data: { attempts: 500, reservedMicros: 5_000_000, storedBytes: 524288000, reads: 5000 } });
    vi.mocked(transport.recognize).mockRejectedValueOnce(new RecognitionFailure("provider-temporary"));
    const original = await input({ allianceId, actorId, memberId: null, scope: "batch" });
    const first = await evaluateScreenshot(original, transport);
    const result = await evaluateScreenshot({ ...original, requestId: crypto.randomUUID(), retryOf: first.id, automaticRetry: true }, transport);
    expect(result.status).toBe("READY");
    await readEvaluationContent(original, result.id, "result", transport);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CUSTOMER_RESOURCES } })).toMatchObject({ attempts: 0, reservedMicros: 0, reads: 1 });
    expect(await db.ocrEvaluationAttempt.count()).toBe(2);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 500, reservedMicros: 5_000_000 });
  });

  it.each(["consent", "budget", "role"] as const)("rechecks %s before the second dispatch", async change => {
    const original = await input({ allianceId, actorId, memberId: null, scope: "batch" });
    vi.mocked(transport.recognize).mockRejectedValueOnce(new RecognitionFailure("provider-temporary"));
    const first = await evaluateScreenshot(original, transport);
    if (change === "consent") await changeProcessing(false);
    if (change === "role") await db.allianceMembership.update({ where: { allianceId_userId: { allianceId, userId: actorId } }, data: { role: "VIEWER" } });
    if (change === "budget") await db.ocrEvaluationBudget.update({ where: { id: OCR_CAMPAIGN }, data: { attempts: 500, reservedMicros: 5_000_000 } });
    await expect(evaluateScreenshot({ ...original, requestId: crypto.randomUUID(), retryOf: first.id, automaticRetry: true }, transport)).rejects.toThrow();
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(await db.ocrEvaluationAttempt.count()).toBe(1);
  });

  it.each(["provider-error", "response-unreadable", "result-too-large"] as const)("retains %s on the original attempt and in history", async reason => {
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    vi.mocked(transport.recognize).mockRejectedValue(new RecognitionFailure(reason));
    const outcome = `processing-failed:${reason}`;
    const original = await input(batch);
    const first = evaluateScreenshot(original, transport);
    if (reason === "result-too-large") {
      const attempt = await first;
      expect(attempt).toMatchObject({ status: "FAILED", outcome });
      expect((await loadEvaluationContext(batch)).attempts[0].retryable).toBe(false);
      await expect(evaluateScreenshot({ ...await input(batch), retryOf: attempt.id }, transport)).rejects.toThrow("unavailable for retry");
    } else await expect(first).rejects.toMatchObject({ outcome, message: recognitionFailureMessage(outcome) });
    const existing = await evaluateScreenshot(original, transport);
    expect(existing).toMatchObject({ status: "FAILED", outcome });
    expect((await loadEvaluationContext(batch)).attempts).toEqual(expect.arrayContaining([expect.objectContaining({ id: existing.id, outcome })]));
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 1, reservedMicros: 10000 });
  });
  it("rescans a reselected failure once and reuses the recovered result", async () => {
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    const original = await input(batch);
    vi.mocked(transport.recognize).mockRejectedValueOnce(new Error("provider failure"));
    await expect(evaluateScreenshot(original, transport)).rejects.toThrow("did not complete");
    const failed = await evaluateScreenshot(original, transport);
    const reupload = { ...original, requestId: crypto.randomUUID(), sourceFilename: "renamed.png" };
    const recovered = await evaluateScreenshot(reupload, transport);
    expect(recovered).toMatchObject({ status: "READY", retryOf: failed.id });
    expect((await evaluateScreenshot(reupload, transport)).id).toBe(recovered.id);
    expect((await evaluateScreenshot({ ...original, requestId: crypto.randomUUID() }, transport)).id).toBe(recovered.id);
    expect(await evaluateScreenshot(original, transport)).toMatchObject({ id: failed.id, status: "FAILED" });
    expect(transport.recognize).toHaveBeenCalledTimes(2);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 2, reservedMicros: 20000 });
  });
  it("keeps a duplicate joined during recognition bound to that scan after it fails", async () => {
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    const original = await input(batch);
    const joined = { ...original, requestId: crypto.randomUUID() };
    const started = Promise.withResolvers<void>();
    const finish = Promise.withResolvers<void>();
    vi.mocked(transport.recognize).mockImplementationOnce(async () => {
      started.resolve();
      await finish.promise;
      throw new Error("provider failure");
    });
    const failure = expect(evaluateScreenshot(original, transport)).rejects.toThrow("did not complete");
    await started.promise;
    try {
      expect(await evaluateScreenshot(joined, transport)).toMatchObject({ status: "PROCESSING" });
    } finally { finish.resolve(); }
    await failure;
    const originalFailure = await evaluateScreenshot(original, transport);
    expect(await evaluateScreenshot(joined, transport)).toMatchObject({ id: originalFailure.id, status: "FAILED" });
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    const fresh = await evaluateScreenshot({ ...original, requestId: crypto.randomUUID() }, transport);
    expect(fresh).toMatchObject({ status: "READY", retryOf: originalFailure.id });
    expect((await evaluateScreenshot(joined, transport)).id).toBe(originalFailure.id);
    expect(transport.recognize).toHaveBeenCalledTimes(2);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({ where: { id: OCR_CAMPAIGN } })).toMatchObject({ attempts: 2, reservedMicros: 20000 });
  });
  it("checks the remaining test allowance before rescanning a reselected failure", async () => {
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    vi.mocked(transport.recognize).mockRejectedValueOnce(new Error("provider failure"));
    await expect(evaluateScreenshot(await input(batch), transport)).rejects.toThrow("did not complete");
    await db.ocrEvaluationBudget.update({ where: { id: OCR_CAMPAIGN }, data: { reservedMicros: 5_000_000 } });
    await expect(evaluateScreenshot(await input(batch), transport)).rejects.toThrow("scanning is paused");
    expect(transport.recognize).toHaveBeenCalledTimes(1);
    expect(await db.ocrEvaluationAttempt.count()).toBe(1);
  });
  it("requires explicit consent for a new charged retry and preserves its failed parent", async () => {
    const batch: EvaluationTarget = { allianceId, actorId, memberId: null, scope: "batch" };
    vi.mocked(transport.recognize).mockRejectedValueOnce(new Error("private provider failure"));
    await expect(evaluateScreenshot({ ...await input(batch), sourceFilename: "C:\\private\\Lundi-\u202eé.png" }, transport)).rejects.toThrow("did not complete");
    const failed = await db.ocrEvaluationAttempt.findFirstOrThrow();
    const wrong = await sharp({create:{width:300,height:300,channels:3,background:"#ab1234"}}).png().toBuffer();
    await expect(evaluateScreenshot({...await input(batch), retryOf:failed.id, bytes:wrong}, transport)).rejects.toThrow("same screenshot");
    const request = { ...await input(batch), retryOf: failed.id, sourceFilename: "copy.png" };
    const retried = await evaluateScreenshot(request, transport);
    expect(retried).toMatchObject({status:"READY",retryOf:failed.id,sourceFilename:"Lundi-é.png"});
    expect(await db.ocrEvaluationAttempt.findUniqueOrThrow({where:{id:failed.id}})).toMatchObject({status:"FAILED"});
    expect((await evaluateScreenshot(request, transport)).id).toBe(retried.id);
    expect((await evaluateScreenshot({...await input(batch),retryOf:failed.id}, transport)).id).toBe(retried.id);
    expect(transport.recognize).toHaveBeenCalledTimes(2);
    expect(await db.ocrEvaluationBudget.findUniqueOrThrow({where:{id:OCR_CAMPAIGN}})).toMatchObject({attempts:2,reservedMicros:20000});
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
    await decideOcrConsent(actorId, { purpose: "PROCESSING", granted: false, expectedId: (await loadOcrConsent(actorId)).processing!.id, noticeVersion: OCR_PROCESSING_NOTICE });
    await expect(evaluateScreenshot(proposed, transport)).rejects.toThrow("Screenshots are disabled");
    await decideOcrConsent(actorId, { purpose: "PROCESSING", granted: true, expectedId: (await loadOcrConsent(actorId)).processing!.id, noticeVersion: OCR_PROCESSING_NOTICE });
    vi.mocked(transport.preflight).mockRejectedValue(new Error("configuration"));
    await expect(evaluateScreenshot(await input(), transport)).rejects.toThrow();
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
    await expect(evaluateScreenshot(await input(), transport)).rejects.toThrow("Screenshot scanning is paused");
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
