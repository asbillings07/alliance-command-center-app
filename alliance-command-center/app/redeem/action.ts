"use server";

import { redirect } from "next/navigation";
import { validateBetaCode } from "@/app/src/lib/betaInvitation";

export type ValidateCodeState = {
  error: string | null;
};

export async function validateCode(
  _prevState: ValidateCodeState,
  formData: FormData
): Promise<ValidateCodeState> {
  const code = formData.get("code");

  if (!code || typeof code !== "string") {
    return { error: "Please enter a beta code" };
  }

  const normalizedCode = code.toUpperCase().trim();

  if (!normalizedCode) {
    return { error: "Please enter a beta code" };
  }

  const invitation = await validateBetaCode(normalizedCode);

  if (!invitation) {
    return { error: "Invalid or expired beta code" };
  }

  redirect(`/redeem/${invitation.token}`);
}
