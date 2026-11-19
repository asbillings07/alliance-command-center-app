import { checkOcrDeploymentIsolation } from "@/app/src/lib/ocr/deploymentIsolation";
import { pilotReservationId, reservePilotAllowance } from "@/app/src/lib/ocr/pilotAllowance";

export async function POST(request: Request) {
  if (process.env.OCR_PILOT_RESERVATIONS !== "true" || checkOcrDeploymentIsolation(process.env).length) {
    return new Response(null, { status: 404 });
  }
  const id = await pilotReservationId(request.headers.get("authorization"));
  if (!id) return new Response(null, { status: 403 });
  try {
    if (await reservePilotAllowance(id)) {
      return new Response(null, { status: 204, headers: { "x-ocr-reservation": id, "Cache-Control": "no-store" } });
    }
    return new Response(null, { status: 409 });
  } catch {
    return new Response(null, { status: 503 });
  }
}
