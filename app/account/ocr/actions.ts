"use server";
import { revalidatePath } from "next/cache";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { decideOcrConsent, loadOcrConsent } from "@/app/src/lib/ocr/consent";
import { OcrEvaluationError } from "@/app/src/lib/ocr/config";

export async function updateOcrConsent(input: Parameters<typeof decideOcrConsent>[1]) {
  const user = await requireAuth();
  try {
    const consent = await decideOcrConsent(user.id, input);
    revalidatePath("/account/ocr");
    return { consent };
  } catch (error) {
    return { error: error instanceof OcrEvaluationError ? error.message : "Your preference could not be saved. Reload to check it." };
  }
}

export async function refreshOcrConsent() {
  const user = await requireAuth();
  try { return { consent: await loadOcrConsent(user.id) }; }
  catch { return { error: "OCR preferences could not be checked. Reload before continuing." }; }
}
