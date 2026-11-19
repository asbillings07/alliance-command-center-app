"use server";
import { auth } from "@/app/src/lib/auth";
import { revalidatePath } from "next/cache";
import { renameQaAlliance } from "@/app/src/lib/ocr/qaAlliance";
import { OcrEvaluationError } from "@/app/src/lib/ocr/config";

export async function saveQaAllianceName(allianceId: string, name: string, identityVersion: number, acknowledged: boolean) {
  const session = await auth();
  if (!session?.user?.id) return { error: "Sign in before editing the QA alliance." };
  if (typeof allianceId !== "string" || typeof name !== "string" || acknowledged !== true) return { error: "Review and confirm a valid QA name change first." };
  try {
    await renameQaAlliance({ allianceId, actorId: session.user.id, name, identityVersion, acknowledged });
    revalidatePath(`/alliances/${allianceId}`, "layout");
    return {};
  } catch (error) {
    if (!(error instanceof OcrEvaluationError)) console.error("QA alliance name save did not confirm; reload its history before retrying.");
    return { error: error instanceof OcrEvaluationError ? error.message : "The QA name could not be saved. Reload to check the current name and change history before trying again." };
  }
}
