import "server-only";
import { Prisma, type OcrConsentPurpose } from "@/app/generated/prisma/client";
import { prisma } from "../prisma";
import { ocrPreferencesAvailable, OcrEvaluationError } from "./config";
import { OCR_PROCESSING_NOTICE, OCR_QUALITY_NOTICE, processingAllowed, type OcrConsentState } from "./consentPolicy";

type Tx = Prisma.TransactionClient;

export async function readOcrConsent(tx: Tx, userId: string): Promise<OcrConsentState> {
  const choices = await Promise.all((["PROCESSING", "QUALITY_REVIEW"] as const).map(purpose =>
    tx.ocrConsentDecision.findFirst({ where: { userId, purpose }, orderBy: { id: "desc" },
      select: { id: true, granted: true, noticeVersion: true, createdAt: true } })));
  const view = (choice: typeof choices[number]) => choice ? { ...choice, createdAt: choice.createdAt.toISOString() } : null;
  return { processing: view(choices[0]), quality: view(choices[1]) };
}

export function requireProcessingConsent(state: OcrConsentState) {
  if (!processingAllowed(state)) throw new OcrEvaluationError(
    "Screenshots are disabled. Review OCR processing in your account Settings before continuing.", "consent-required");
}

export async function canManageOcrPreferences(userId: string) {
  if (ocrPreferencesAvailable(userId)) return true;
  if (process.env.VERCEL_ENV !== "production") return false;
  return !!await prisma.ocrConsentDecision.findFirst({ where: { userId }, select: { id: true } });
}

export async function loadOcrConsent(userId: string) {
  if (!await canManageOcrPreferences(userId)) throw new OcrEvaluationError("OCR settings are unavailable here.");
  return prisma.$transaction(async tx => {
    if (!await tx.user.findUnique({ where: { id: userId }, select: { id: true } })) throw new OcrEvaluationError("Sign in again.");
    return readOcrConsent(tx, userId);
  });
}

/** The action supplies the authenticated account. No client-supplied subject. */
export async function decideOcrConsent(userId: string, input: {
  purpose: OcrConsentPurpose; granted: boolean; expectedId: number | null; noticeVersion: string;
}) {
  if (!ocrPreferencesAvailable(userId) && (input.granted || !await canManageOcrPreferences(userId))) throw new OcrEvaluationError("OCR settings are unavailable here.");
  if (!["PROCESSING", "QUALITY_REVIEW"].includes(input.purpose) || typeof input.granted !== "boolean"
    || (input.expectedId !== null && (!Number.isSafeInteger(input.expectedId) || input.expectedId < 1))) {
    throw new OcrEvaluationError("Reload your OCR settings before saving.");
  }
  const noticeVersion = input.purpose === "PROCESSING" ? OCR_PROCESSING_NOTICE : OCR_QUALITY_NOTICE;
  if (input.noticeVersion !== noticeVersion) throw new OcrEvaluationError("The notice changed. Reload and review it before saving.");
  try {
    return await prisma.$transaction(async tx => {
      // Serializing on the account orders decisions, including the first one.
      const accounts = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
      if (!accounts.length) throw new OcrEvaluationError("Sign in again.");
      const state = await readOcrConsent(tx, userId);
      const current = input.purpose === "PROCESSING" ? state.processing : state.quality;
      // Repeated delivery of the same successful choice is harmless. A stale
      // opposite choice must never silently undo a later revocation.
      if (current?.granted === input.granted && current.noticeVersion === noticeVersion) return state;
      if ((current?.id ?? null) !== input.expectedId) throw new OcrEvaluationError("Your preference changed in another tab. Reload and review the current setting.");
      // Leaving the default-off optional setting alone is not an explicit refusal.
      if (input.purpose === "QUALITY_REVIEW" && !current && !input.granted) return state;
      await tx.ocrConsentDecision.create({ data: { userId, purpose: input.purpose, granted: input.granted, noticeVersion } });
      // Invalidates a concurrent Serializable OCR transaction's old snapshot.
      await tx.user.update({ where: { id: userId }, data: { ocrConsentVersion: { increment: 1 } } });
      return readOcrConsent(tx, userId);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted, timeout: 10_000 });
  } catch (error) {
    if (error instanceof OcrEvaluationError) throw error;
    throw new OcrEvaluationError("Your preference could not be saved. Reload to check its status before trying again.");
  }
}
