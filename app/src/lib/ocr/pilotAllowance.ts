import "server-only";
import { getVercelOidcToken, verifyVercelOidcToken } from "@vercel/oidc";
import { prisma } from "../prisma";
import { OCR_CAMPAIGN, OCR_RESERVATION_MICROS, OcrEvaluationError } from "./config";

// Only an opaque one-use ID crosses environments. Neither side receives
// credentials for the other database or access to its screenshots.
const endpoint = "https://alliance-command-center-env-acc-ocr-eval-aptelum-labs.vercel.app/api/ocr-pilot-reservations";
const issuer = "https://oidc.vercel.com/aptelum-labs";
const validId = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function pilotReservationId(authorization: string | null) {
  if (!authorization?.startsWith("Bearer ") || authorization.length > 16384) return null;
  try {
    const { payload } = await verifyVercelOidcToken(authorization.slice(7), {
      issuer, audience: endpoint, environment: "production",
      projectId: "prj_eEU60PIovJyutoJeSXgEPURndcRi", ownerId: "team_ovHr1s3JHHZaL2VglNms1ILB",
      requiredClaims: ["exp", "iat", "jti"], algorithms: ["RS256"],
    });
    return typeof payload.jti === "string" && validId.test(payload.jti) ? payload.jti : null;
  } catch { return null; }
}

export async function reservePilotAllowance(id: string) {
  return prisma.$transaction(async tx => {
    // Serialize with the original QA admission transaction on the same row.
    const row = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "OcrEvaluationBudget" WHERE id = ${OCR_CAMPAIGN} FOR UPDATE`;
    if (!row.length) return false;
    if (await tx.ocrPilotReservation.findUnique({ where: { id } })) return false;
    const reserved = await tx.ocrEvaluationBudget.updateMany({
      where: { id: OCR_CAMPAIGN, reservedMicros: { lte: 5_000_000 - OCR_RESERVATION_MICROS }, attempts: { lt: 500 } },
      data: { reservedMicros: { increment: OCR_RESERVATION_MICROS }, attempts: { increment: 1 } },
    });
    if (reserved.count !== 1) return false;
    await tx.ocrPilotReservation.create({ data: { id } });
    return true;
  });
}

export async function reserveBeforeProductionScan(attemptId: string) {
  if (process.env.VERCEL_ENV !== "production") return;
  try {
    const token = await getVercelOidcToken({ audience: endpoint, jti: attemptId });
    const response = await fetch(endpoint, {
      method: "POST", headers: { Authorization: `Bearer ${token}` },
      redirect: "error", cache: "no-store", signal: AbortSignal.timeout(10_000),
    });
    // A duplicate, timeout or lost response is never permission to dispatch.
    if (response.status === 204 && response.headers.get("x-ocr-reservation") === attemptId) return;
  } catch { /* Keep tokens, provider errors and request details out of logs. */ }
  throw new OcrEvaluationError("Screenshot scanning is paused. You can still use manual entry or spreadsheets.");
}
