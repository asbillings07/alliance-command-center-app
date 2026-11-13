"use server";

import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { issueAssistedPasswordReset } from "@/app/src/lib/platform/passwordRecovery";
import { getAppOrigin, getResetPasswordUrl } from "@/app/src/lib/appUrl";

export type RecoveryActionResult =
  | { ok: true; resetUrl: string; expiresAt: string }
  | { ok: false; error: string };

export async function createRecoveryLink(form: FormData): Promise<RecoveryActionResult> {
  const actor = await requirePlatformAdmin();
  const field = (name: string) => typeof form.get(name) === "string" ? form.get(name) as string : "";
  try {
    // Validate the deployment's trusted origin before any token is persisted.
    getAppOrigin();
    const result = await issueAssistedPasswordReset(actor.id, {
      targetUserId: field("targetUserId"), expectedEmail: field("expectedEmail"),
      operatorPassword: field("operatorPassword"), identityConfirmed: field("identityConfirmed") === "yes",
    });
    if (!result.ok) return result;
    return { ok: true, resetUrl: getResetPasswordUrl(result.rawToken), expiresAt: result.expiresAt.toISOString() };
  } catch {
    // Never log FormData, credentials, raw tokens or ORM error payloads.
    console.error("[platform-recovery] Recovery link creation could not be confirmed");
    return { ok: false, error: "Could not confirm link creation. Refresh to check the issuance history before trying again. Any newly created link replaces older reset links." };
  }
}
