import { auth } from "@/app/src/lib/auth";
import { authorizeScreenshotUpload, evaluateScreenshot, readEvaluationContent } from "@/app/src/lib/ocr/evaluation";
import { evaluationTransport } from "@/app/src/lib/ocr/transport";
import { OCR_MAX_INPUT_BYTES, OcrEvaluationError, requireOcrEvaluation } from "@/app/src/lib/ocr/config";
import { boundedBody } from "@/app/src/lib/ocr/provider";
import { isAllianceRejection } from "@/app/src/lib/ocr/allianceEvidence";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const fail = (error: unknown) => Response.json({ error: error instanceof OcrEvaluationError ? error.message : "Screenshot evaluation is unavailable. Reload to check your access and scan history before trying again.",
  ...(error instanceof OcrEvaluationError && isAllianceRejection(error) ? { outcome: error.outcome } : {}) }, { status: 400, headers });

export async function POST(request: Request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) return Response.json({ error: "Reload this page before uploading." }, { status: 403, headers });
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in before uploading." }, { status: 401, headers });
  try {
    const url = new URL(request.url); const allianceId = url.searchParams.get("allianceId") ?? "";
    requireOcrEvaluation(allianceId);
    const target = { allianceId, actorId: session.user.id, memberId: url.searchParams.get("memberId") || null,
      scope: url.searchParams.get("scope") === "batch" ? "batch" as const : undefined };
    await authorizeScreenshotUpload(target);
    const limit = OCR_MAX_INPUT_BYTES + 16 * 1024;
    if (Number(request.headers.get("content-length")) > limit) throw new OcrEvaluationError("Choose one PNG or JPEG no larger than 2 MB.");
    // Bound the stream even when Content-Length is absent or forged.
    const bytes = await boundedBody(new Response(request.body), limit);
    const form = await new Response(bytes, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("screenshot");
    if (!(file instanceof File)) throw new OcrEvaluationError("Choose a screenshot first.");
    const result = await evaluateScreenshot({ allianceId, actorId: session.user.id,
      memberId: url.searchParams.get("memberId") || null, scope: url.searchParams.get("scope") === "batch" ? "batch" : undefined, requestId: String(form.get("requestId") ?? ""),
      contextKey: String(form.get("contextKey") ?? ""), retryFailed: form.get("retryFailed") === "true",
      bytes: new Uint8Array(await file.arrayBuffer()) }, await evaluationTransport());
    return Response.json(result, { headers });
  } catch (error) { return fail(error); }
}

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user?.id) return Response.json({ error: "Sign in to view this screenshot." }, { status: 401, headers });
  try {
    const url = new URL(request.url); const allianceId = url.searchParams.get("allianceId") ?? "";
    requireOcrEvaluation(allianceId);
    const kind = url.searchParams.get("kind");
    if (kind !== "image" && kind !== "result") throw new OcrEvaluationError("Choose a screenshot from your review history.");
    const result = await readEvaluationContent({ allianceId, actorId: session.user.id, memberId: url.searchParams.get("memberId") || null, scope: url.searchParams.get("scope") === "batch" ? "batch" : undefined },
      url.searchParams.get("id") ?? "", kind, await evaluationTransport());
    if (result instanceof Uint8Array) return new Response(Buffer.from(result), { headers: { ...headers, "Content-Type": "image/png", "Content-Disposition": 'inline; filename="vs-screenshot.png"' } });
    return Response.json(result, { headers });
  } catch (error) { return fail(error); }
}
