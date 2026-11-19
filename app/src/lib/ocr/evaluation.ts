import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type AllianceRole, type OcrEvaluationAttempt } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { buildPermissionSet } from "../auth/permissions";
import { readIdentitySnapshot } from "../memberIdentity";
import { OCR_CAMPAIGN, OCR_MAX_IMAGE_BYTES, OCR_MAX_RESULT_BYTES, OCR_RESERVATION_MICROS, OCR_RETENTION_MS, OCR_VERSION, OcrEvaluationError, requireOcrEvaluation } from "./config";
import { requireOcrRollout } from "./rollout";
import { readOcrConsent, requireProcessingConsent } from "./consent";
import { qualityAllowed } from "./consentPolicy";
import { normalizeScreenshot } from "./image";
import type { OcrTransport } from "./provider";
import { reviewDailyVs } from "./recognition";
import { readRankingContext } from "./rankingContext";
import { reviewRanking, type RankingRecognition, type RosterMember } from "./ranking";
import { allianceRejectionMessage, checkScreenshotAlliance, isAllianceRejection } from "./allianceEvidence";

export type EvaluationTarget = { allianceId: string; actorId: string; memberId: string | null; scope?: "batch" };
type Tx = Prisma.TransactionClient;

async function context(tx: Tx, target: EvaluationTarget, processing = true, consentRequired = true) {
  await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${target.actorId} FOR SHARE`;
  const actor = await tx.user.findUnique({ where: { id: target.actorId }, select: { id: true, displayName: true } });
  if (!actor) throw new OcrEvaluationError("Sign in again before evaluating a screenshot.");
  const consent = await readOcrConsent(tx, actor.id);
  if (consentRequired) requireProcessingConsent(consent);
  if (target.scope === "batch") {
    if (target.memberId) throw new OcrEvaluationError("Choose either a batch or a member review.");
    const [membership] = await tx.$queryRaw<{ role: AllianceRole }[]>`
      SELECT "role" FROM "AllianceMembership" WHERE "allianceId" = ${target.allianceId}
        AND "userId" = ${target.actorId} FOR SHARE`;
    if (!membership || !buildPermissionSet(membership.role).canImportMetrics) throw new OcrEvaluationError("You do not have permission to import ranking screenshots.");
    const alliance = await tx.alliance.findUnique({ where: { id: target.allianceId }, select: { id: true, name: true, server: true, identityVersion: true } });
    if (!alliance?.name.trim() || !alliance.server.trim()) throw new OcrEvaluationError("Review the alliance name and server before importing screenshots.");
    const { id: authorizedAllianceId, ...allianceIdentity } = alliance;
    await requireOcrRollout({ userId: actor.id, allianceId: authorizedAllianceId });
    const roster = await tx.allianceMember.findMany({ where: { allianceId: target.allianceId },
      select: { id: true, playerName: true, archivedAt: true, identityVersion: true }, orderBy: { id: "asc" }, take: 2001 });
    if (roster.length > 2000) throw new OcrEvaluationError("This trial supports up to 2,000 roster records.");
    const members: RosterMember[] = roster.map(m => ({ id: m.id, playerName: m.playerName, archived: !!m.archivedAt }));
    return { consent, memberId: null, actorName: actor.displayName, actorRole: membership.role, playerName: "Alliance ranking capture",
      allianceName: alliance.name, server: alliance.server, members,
      contextKey: createHash("sha256").update(JSON.stringify([allianceIdentity, membership.role, roster])).digest("hex") };
  }
  let memberId: string; let role: AllianceRole | "MEMBER"; let grantId: number | null = null;
  if (target.memberId) {
    const [membership] = await tx.$queryRaw<{ role: AllianceRole }[]>`
      SELECT "role" FROM "AllianceMembership" WHERE "allianceId" = ${target.allianceId}
        AND "userId" = ${target.actorId} FOR SHARE`;
    if (!membership || !buildPermissionSet(membership.role).canImportMetrics) throw new OcrEvaluationError("You do not have permission to review this member's screenshots.");
    role = membership.role; memberId = target.memberId;
  } else {
    const linked = await tx.allianceMember.findMany({ where: { allianceId: target.allianceId, userId: target.actorId }, select: { id: true }, take: 2 });
    if (linked.length !== 1) throw new OcrEvaluationError("Your member identity and access need leadership review before OCR is available.");
    memberId = linked[0].id; role = "MEMBER";
  }
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`member-identity:${memberId}`}, 0))`;
  await tx.$queryRaw`SELECT m."id" FROM "AllianceMember" m JOIN "Alliance" a ON a."id" = m."allianceId"
    WHERE m."id" = ${memberId} AND m."allianceId" = ${target.allianceId} FOR SHARE OF m, a`;
  const identity = await readIdentitySnapshot(tx, target.allianceId, memberId);
  if (role === "MEMBER") {
    const grant = await tx.memberSelfAccessDecision.findFirst({ where: { allianceId: target.allianceId, memberId }, orderBy: { id: "desc" } });
    if (!identity.confirmed || identity.member.userId !== target.actorId || !grant?.granted
      || grant.accountUserId !== target.actorId || grant.identityDecisionId !== identity.decisions[0]?.id) {
      throw new OcrEvaluationError("Your member identity and access need leadership review before OCR is available.");
    }
    grantId = grant.id;
  }
  if (processing && (identity.member.archivedAt || !identity.member.playerName.trim()
    || !identity.member.alliance.name.trim() || !identity.member.alliance.server.trim())) {
    throw new OcrEvaluationError("Review the active member's name, alliance and server before evaluating a screenshot.");
  }
  await requireOcrRollout({ userId: actor.id, allianceId: identity.member.alliance.id });
  return { consent, members: [] as RosterMember[], memberId, actorName: actor.displayName, actorRole: role, playerName: identity.member.playerName,
    allianceName: identity.member.alliance.name, server: identity.member.alliance.server,
    contextKey: JSON.stringify([identity.reviewKey, role, grantId]) };
}

function transaction<T>(fn: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
}

/** Discovery uses the same current authorization and flag as direct requests. */
export async function ocrEvaluationAvailable(target: EvaluationTarget): Promise<boolean> {
  try {
    requireOcrEvaluation(target.allianceId);
    await transaction(tx => context(tx, target, true, false));
    return true;
  } catch { return false; }
}

export async function loadEvaluationContext(target: EvaluationTarget) {
  requireOcrEvaluation(target.allianceId);
  return transaction(async tx => {
    const current = await context(tx, target, true, false);
    const attempts = await tx.ocrEvaluationAttempt.findMany({ where: {
      allianceId: target.allianceId, memberId: current.memberId,
      ...(current.actorRole === "MEMBER" ? { actorUserId: target.actorId } : {}),
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
    return { consent: current.consent, processingConsentId: current.consent.processing?.id ?? null, playerName: current.playerName, allianceName: current.allianceName, server: current.server,
      leader: current.actorRole !== "MEMBER", members: current.members, contextKey: current.contextKey,
      attempts: attempts.map(auditView) };
  });
}

function auditView(attempt: OcrEvaluationAttempt) {
  return { id: attempt.id, createdAt: attempt.createdAt.toISOString(), expiresAt: attempt.expiresAt.toISOString(),
    actorName: attempt.actorName, actorRole: attempt.actorRole, playerName: attempt.playerName,
    status: attempt.status, outcome: attempt.outcome, retryOf: attempt.retryOf };
}

async function unchanged(target: EvaluationTarget, key: string, processingConsentId: number) {
  requireOcrEvaluation(target.allianceId);
  await transaction(async tx => {
    const current = await context(tx, target);
    if (current.consent.processing?.id !== processingConsentId) throw new OcrEvaluationError("Your OCR preference changed. Reload before continuing.");
    if (current.contextKey !== key) throw new OcrEvaluationError("The member's identity or access changed. Reload and review the current details.");
  });
}

export async function authorizeScreenshotUpload(target: EvaluationTarget) {
  requireOcrEvaluation(target.allianceId);
  await transaction(tx => context(tx, target));
}

export async function evaluateScreenshot(input: EvaluationTarget & {
  requestId: string; contextKey: string; bytes: Uint8Array; processingConsentId: number; retryFailed?: boolean;
}, transport: OcrTransport) {
  requireOcrEvaluation(input.allianceId);
  if (!Number.isSafeInteger(input.processingConsentId) || input.processingConsentId < 1) throw new OcrEvaluationError("Reload to review your OCR processing preference.");
  if (!/^[a-f0-9-]{36}$/i.test(input.requestId) || input.contextKey.length > 1500) throw new OcrEvaluationError("Reload this review before uploading.");
  if (input.retryFailed && input.scope !== "batch") throw new OcrEvaluationError("Explicit retries are available only in the leader ranking trial.");
  await unchanged(input, input.contextKey, input.processingConsentId);
  const image = await normalizeScreenshot(input.bytes);
  // Preflight cannot process or store the screenshot, and precedes spending.
  await transport.preflight();
  const admitted = await transaction(async tx => {
    const current = await context(tx, input);
    if (current.consent.processing?.id !== input.processingConsentId) throw new OcrEvaluationError("Your OCR preference changed. Reload before continuing.");
    if (current.contextKey !== input.contextKey) throw new OcrEvaluationError("The member's identity or access changed. Reload this review.");
    // One shared ledger lock serializes reservations across every instance.
    await tx.$queryRaw`SELECT "id" FROM "OcrEvaluationBudget" WHERE "id" = ${OCR_CAMPAIGN} FOR UPDATE`;
    const existing = await tx.ocrEvaluationAttempt.findUnique({ where: { actorUserId_requestId: { actorUserId: input.actorId, requestId: input.requestId } } });
    if (existing) {
      if (existing.allianceId !== input.allianceId || existing.memberId !== current.memberId
        || existing.sourceDigest !== image.digest || existing.processingVersion !== OCR_VERSION
        || existing.contextKey !== current.contextKey || existing.processingConsentId !== input.processingConsentId) throw new OcrEvaluationError("This upload reference belongs to a different review. Choose the screenshot again.");
      return { attempt: existing, dispatched: false };
    }
    // Reuse identical batch captures in this unchanged review context. A failed
    // attempt is not automatically sent again under a fresh client request ID.
    let retryOf: string | null = null;
    if (input.scope === "batch") {
      const duplicate = await tx.ocrEvaluationAttempt.findFirst({ where: { allianceId: input.allianceId, memberId: null,
        actorUserId: input.actorId, sourceDigest: image.digest, contextKey: current.contextKey, processingConsentId: input.processingConsentId,
        processingVersion: OCR_VERSION, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
      if (duplicate) {
        if (duplicate.status !== "FAILED" || isAllianceRejection(duplicate) || input.retryFailed !== true) return { attempt: duplicate, dispatched: false };
        retryOf = duplicate.id;
      }
    }
    const now = new Date(); const since = new Date(now); since.setUTCHours(0, 0, 0, 0);
    if (await tx.ocrEvaluationAttempt.count({ where: { actorUserId: input.actorId, createdAt: { gte: since } } }) >= 20) {
      throw new OcrEvaluationError("Your 20-scan daily evaluation limit has been reached. You can still review earlier scans.");
    }
    const reserved = await tx.ocrEvaluationBudget.updateMany({ where: { id: OCR_CAMPAIGN,
      reservedMicros: { lte: 5_000_000 - OCR_RESERVATION_MICROS }, attempts: { lt: 500 },
      storedBytes: { lte: 500 * 1024 * 1024 - image.bytes.length } },
      data: { reservedMicros: { increment: OCR_RESERVATION_MICROS }, attempts: { increment: 1 }, storedBytes: { increment: image.bytes.length } } });
    if (reserved.count !== 1) throw new OcrEvaluationError("The evaluation budget has been reached. Further scans are paused.");
    const attempt = await tx.ocrEvaluationAttempt.create({ data: {
      id: randomUUID(), requestId: input.requestId, retryOf, allianceId: input.allianceId, memberId: current.memberId,
      actorUserId: input.actorId, actorName: current.actorName, actorRole: current.actorRole,
      playerName: current.playerName, allianceName: current.allianceName, server: current.server,
      contextKey: current.contextKey, sourceDigest: image.digest, processingVersion: OCR_VERSION,
      processingConsentId: current.consent.processing!.id, qualityConsentId: qualityAllowed(current.consent) ? current.consent.quality!.id : null,
      imageBytes: image.bytes.length, createdAt: now, expiresAt: new Date(now.getTime() + OCR_RETENTION_MS),
    } });
    return { attempt, dispatched: true };
  });
  if (!admitted.dispatched) return auditView(admitted.attempt);
  const attempt = admitted.attempt;
  let failureStage = "source-storage";
  try {
    await unchanged(input, attempt.contextKey, input.processingConsentId);
    await transport.put(`${attempt.id}/source.png`, image.bytes, "image/png");
    failureStage = "recognition";
    await unchanged(input, attempt.contextKey, input.processingConsentId);
    const recognition = await transport.recognize(image);
    await unchanged(input, attempt.contextKey, input.processingConsentId);
    const rankingContext = await readRankingContext(image.bytes, recognition);
    const content = Buffer.from(JSON.stringify({ ...recognition, rankingContext }));
    if (content.length > OCR_MAX_RESULT_BYTES) throw new Error("Recognition too large");
    failureStage = "result-storage";
    await transport.put(`${attempt.id}/recognition.json`, content, "application/json");
    failureStage = "finalization";
    const complete = await transaction(async tx => {
      const current = await context(tx, input);
      if (current.consent.processing?.id !== input.processingConsentId) throw new OcrEvaluationError("Your OCR preference changed. Reload before continuing.");
      if (current.contextKey !== attempt.contextKey) throw new OcrEvaluationError("The member's identity or access changed. Reload this review.");
      const allianceEvidence = checkScreenshotAlliance({ ...recognition, rankingContext }, { name: attempt.allianceName, server: attempt.server });
      return tx.ocrEvaluationAttempt.update({ where: { id: attempt.id }, data: allianceEvidence === "matched"
        ? { status: "READY", outcome: "recognition-ready" }
        : { status: "FAILED", outcome: `alliance-${allianceEvidence}` } });
    });
    return auditView(complete);
  } catch (error) {
    // Never log provider errors: they may contain image bytes or recognized text.
    await prisma.ocrEvaluationAttempt.updateMany({ where: { id: attempt.id, status: "PROCESSING" }, data: { status: "FAILED", outcome: `processing-failed:${failureStage}` } });
    if (error instanceof OcrEvaluationError) throw error;
    throw new OcrEvaluationError("The scan did not complete. No scores changed. It will not be retried automatically; reload to check its history before choosing another scan.");
  }
}

async function authorizedAttempt(tx: Tx, target: EvaluationTarget, id: string) {
  const current = await context(tx, target, false);
  const attempt = await tx.ocrEvaluationAttempt.findFirst({ where: { id, allianceId: target.allianceId, memberId: current.memberId,
    ...(current.actorRole === "MEMBER" ? { actorUserId: target.actorId } : {}) } });
  if (!attempt) throw new OcrEvaluationError("This screenshot is not available to this account.");
  if (attempt.expiresAt.getTime() <= Date.now()) throw new OcrEvaluationError("The 30-day screenshot and recognition retention period has ended. Its upload history remains available.");
  return { attempt, current };
}

export async function readEvaluationContent(target: EvaluationTarget, id: string, kind: "image" | "result", transport: OcrTransport) {
  requireOcrEvaluation(target.allianceId);
  const attempt = await transaction(async tx => {
    const { attempt } = await authorizedAttempt(tx, target, id);
    if (isAllianceRejection(attempt)) throw new OcrEvaluationError(allianceRejectionMessage(attempt.outcome), attempt.outcome);
    if (attempt.status !== "READY") throw new OcrEvaluationError("Recognition is not ready. Interrupted scans are never automatically retried.");
    const reserved = await tx.ocrEvaluationBudget.updateMany({ where: { id: OCR_CAMPAIGN, reads: { lt: 5000 } }, data: { reads: { increment: 1 } } });
    if (!reserved.count) throw new OcrEvaluationError("The evaluation viewing limit has been reached.");
    return attempt;
  });
  // A source-image URL must not bypass the same alliance check as its result.
  // Requalify older READY scans against the current alliance, without rescanning.
  if (kind === "image") {
    await readEvaluationContent(target, id, "result", transport);
  }
  const bytes = await transport.read(`${attempt.id}/${kind === "image" ? "source.png" : "recognition.json"}`, kind === "image" ? OCR_MAX_IMAGE_BYTES : OCR_MAX_RESULT_BYTES);
  // Revocation/expiry while storage is responding must not disclose content.
  const { current } = await transaction(tx => authorizedAttempt(tx, target, id));
  if (kind === "image") {
    if (current.allianceName !== attempt.allianceName || current.server !== attempt.server) {
      throw new OcrEvaluationError("The alliance identity changed since this scan. Start a new review with the current alliance details. No results were added.");
    }
    if (createHash("sha256").update(bytes).digest("hex") !== attempt.sourceDigest) {
      throw new OcrEvaluationError("The retained screenshot could not be verified. No scores changed.");
    }
    return bytes;
  }
  const recognition = JSON.parse(Buffer.from(bytes).toString()) as RankingRecognition;
  const evidence = checkScreenshotAlliance(recognition, { name: current.allianceName, server: current.server });
  if (evidence !== "matched") throw new OcrEvaluationError(allianceRejectionMessage(`alliance-${evidence}`), `alliance-${evidence}`);
  if (current.allianceName !== attempt.allianceName || current.server !== attempt.server) {
    throw new OcrEvaluationError("The alliance identity changed since this scan. Start a new review with the current alliance details. No results were added.");
  }
  return { recognition, batchReview: target.scope === "batch" ? reviewRanking(recognition, current.members) : null, review: reviewDailyVs(recognition, attempt.playerName), attempt: auditView(attempt),
    capturedTarget: { playerName: attempt.playerName, allianceName: attempt.allianceName, server: attempt.server },
    contextChanged: current.contextKey !== attempt.contextKey };
}
