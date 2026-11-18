import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma, type AllianceRole, type OcrEvaluationAttempt } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { buildPermissionSet } from "../auth/permissions";
import { readIdentitySnapshot } from "../memberIdentity";
import { OCR_CAMPAIGN, OCR_MAX_IMAGE_BYTES, OCR_MAX_RESULT_BYTES, OCR_RESERVATION_MICROS, OCR_RETENTION_MS, OCR_VERSION, OcrEvaluationError, requireOcrEvaluation } from "./config";
import { normalizeScreenshot } from "./image";
import type { OcrTransport } from "./provider";
import { reviewDailyVs, type Recognition } from "./recognition";

export type EvaluationTarget = { allianceId: string; actorId: string; memberId: string | null };
type Tx = Prisma.TransactionClient;

async function context(tx: Tx, target: EvaluationTarget, processing = true) {
  const actor = await tx.user.findUnique({ where: { id: target.actorId }, select: { id: true, displayName: true } });
  if (!actor) throw new OcrEvaluationError("Sign in again before evaluating a screenshot.");
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
  return { memberId, actorName: actor.displayName, actorRole: role, playerName: identity.member.playerName,
    allianceName: identity.member.alliance.name, server: identity.member.alliance.server,
    contextKey: JSON.stringify([identity.reviewKey, role, grantId]) };
}

function transaction<T>(fn: (tx: Tx) => Promise<T>) {
  return prisma.$transaction(fn, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, timeout: 10_000 });
}

export async function loadEvaluationContext(target: EvaluationTarget) {
  requireOcrEvaluation(target.allianceId);
  return transaction(async tx => {
    const current = await context(tx, target);
    const attempts = await tx.ocrEvaluationAttempt.findMany({ where: {
      allianceId: target.allianceId, memberId: current.memberId,
      ...(current.actorRole === "MEMBER" ? { actorUserId: target.actorId } : {}),
    }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
    return { playerName: current.playerName, allianceName: current.allianceName, server: current.server,
      leader: current.actorRole !== "MEMBER", contextKey: current.contextKey,
      attempts: attempts.map(auditView) };
  });
}

function auditView(attempt: OcrEvaluationAttempt) {
  return { id: attempt.id, createdAt: attempt.createdAt.toISOString(), expiresAt: attempt.expiresAt.toISOString(),
    actorName: attempt.actorName, actorRole: attempt.actorRole, playerName: attempt.playerName,
    status: attempt.status, outcome: attempt.outcome };
}

async function unchanged(target: EvaluationTarget, key: string) {
  requireOcrEvaluation(target.allianceId);
  await transaction(async tx => {
    if ((await context(tx, target)).contextKey !== key) throw new OcrEvaluationError("The member's identity or access changed. Reload and review the current details.");
  });
}

export async function evaluateScreenshot(input: EvaluationTarget & {
  requestId: string; contextKey: string; bytes: Uint8Array; consent: boolean;
}, transport: OcrTransport) {
  requireOcrEvaluation(input.allianceId);
  if (input.consent !== true) throw new OcrEvaluationError("Confirm screenshot processing and retention before continuing.");
  if (!/^[a-f0-9-]{36}$/i.test(input.requestId) || input.contextKey.length > 1500) throw new OcrEvaluationError("Reload this review before uploading.");
  await unchanged(input, input.contextKey);
  const image = await normalizeScreenshot(input.bytes);
  // Preflight cannot process or store the screenshot, and precedes spending.
  await transport.preflight();
  const admitted = await transaction(async tx => {
    const current = await context(tx, input);
    if (current.contextKey !== input.contextKey) throw new OcrEvaluationError("The member's identity or access changed. Reload this review.");
    // One shared ledger lock serializes reservations across every instance.
    await tx.$queryRaw`SELECT "id" FROM "OcrEvaluationBudget" WHERE "id" = ${OCR_CAMPAIGN} FOR UPDATE`;
    const existing = await tx.ocrEvaluationAttempt.findUnique({ where: { actorUserId_requestId: { actorUserId: input.actorId, requestId: input.requestId } } });
    if (existing) {
      if (existing.allianceId !== input.allianceId || existing.memberId !== current.memberId
        || existing.sourceDigest !== image.digest || existing.processingVersion !== OCR_VERSION
        || existing.contextKey !== current.contextKey) throw new OcrEvaluationError("This upload reference belongs to a different review. Choose the screenshot again.");
      return { attempt: existing, dispatched: false };
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
      id: randomUUID(), requestId: input.requestId, allianceId: input.allianceId, memberId: current.memberId,
      actorUserId: input.actorId, actorName: current.actorName, actorRole: current.actorRole,
      playerName: current.playerName, allianceName: current.allianceName, server: current.server,
      contextKey: current.contextKey, sourceDigest: image.digest, processingVersion: OCR_VERSION,
      imageBytes: image.bytes.length, createdAt: now, expiresAt: new Date(now.getTime() + OCR_RETENTION_MS),
    } });
    return { attempt, dispatched: true };
  });
  if (!admitted.dispatched) return auditView(admitted.attempt);
  const attempt = admitted.attempt;
  try {
    await transport.put(`${attempt.id}/source.png`, image.bytes, "image/png");
    await unchanged(input, attempt.contextKey);
    const recognition = await transport.recognize(image);
    await unchanged(input, attempt.contextKey);
    const content = Buffer.from(JSON.stringify(recognition));
    if (content.length > OCR_MAX_RESULT_BYTES) throw new Error("Recognition too large");
    await transport.put(`${attempt.id}/recognition.json`, content, "application/json");
    const complete = await transaction(async tx => {
      if ((await context(tx, input)).contextKey !== attempt.contextKey) throw new OcrEvaluationError("The member's identity or access changed. Reload this review.");
      return tx.ocrEvaluationAttempt.update({ where: { id: attempt.id }, data: { status: "READY", outcome: "recognition-ready" } });
    });
    return auditView(complete);
  } catch (error) {
    // Never log provider errors: they may contain image bytes or recognized text.
    await prisma.ocrEvaluationAttempt.updateMany({ where: { id: attempt.id, status: "PROCESSING" }, data: { status: "FAILED", outcome: "processing-failed" } });
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
    if (kind === "result" && attempt.status !== "READY") throw new OcrEvaluationError("Recognition is not ready. Interrupted scans are never automatically retried.");
    const reserved = await tx.ocrEvaluationBudget.updateMany({ where: { id: OCR_CAMPAIGN, reads: { lt: 5000 } }, data: { reads: { increment: 1 } } });
    if (!reserved.count) throw new OcrEvaluationError("The evaluation viewing limit has been reached.");
    return attempt;
  });
  const bytes = await transport.read(`${attempt.id}/${kind === "image" ? "source.png" : "recognition.json"}`, kind === "image" ? OCR_MAX_IMAGE_BYTES : OCR_MAX_RESULT_BYTES);
  // Revocation/expiry while storage is responding must not disclose content.
  const { current } = await transaction(tx => authorizedAttempt(tx, target, id));
  if (kind === "image") {
    if (createHash("sha256").update(bytes).digest("hex") !== attempt.sourceDigest) {
      throw new OcrEvaluationError("The retained screenshot could not be verified. No scores changed.");
    }
    return bytes;
  }
  const recognition = JSON.parse(Buffer.from(bytes).toString()) as Recognition;
  return { recognition, review: reviewDailyVs(recognition, attempt.playerName), attempt: auditView(attempt),
    capturedTarget: { playerName: attempt.playerName, allianceName: attempt.allianceName, server: attempt.server },
    contextChanged: current.contextKey !== attempt.contextKey };
}
