"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { refreshCurrentSession } from "@/app/src/lib/auth/session";
import {
  getSignInMethods,
  updateCredential,
  updateDisplayName,
  validateDisplayName,
  validatePassword,
  verifyPassword,
} from "@/app/src/lib/account";
import {
  beginEmailChange as beginEmailChangeService,
  type BeginEmailChangeReason,
} from "@/app/src/lib/emailChange";
import { emailService } from "@/app/src/lib/email";
import { getEmailChangeVerifyUrl } from "@/app/src/lib/appUrl";

export type UpdateProfileState = {
  status: "idle" | "success" | "error";
  message: string | null;
};

/**
 * Update the signed-in user's editable profile (currently just display name).
 *
 * Pure orchestration: authenticate, validate, delegate persistence to the
 * account service, then revalidate. Persistence details stay in the service.
 */
export async function updateProfile(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const { id } = await requireAuth();

  const result = validateDisplayName(formData.get("displayName"));
  if (!result.ok) {
    return { status: "error", message: result.message };
  }

  await updateDisplayName(id, result.value);

  revalidatePath("/account");
  return { status: "success", message: "Display name updated" };
}

/**
 * Set or change the signed-in user's password.
 *
 * - Google-only accounts (no existing password) may add one without proving a
 *   current password: it is additive and the user is already authenticated.
 * - Accounts that already have a password must prove the current one first.
 *
 * Changing the credential invalidates all previously issued sessions (older
 * devices are signed out on their next request). The current device is then
 * re-issued a fresh session via refreshCurrentSession so the user who just made
 * the change is never logged out. bcrypt hashing and persistence stay in the
 * account service; the re-auth mechanism stays in the auth layer.
 */
export async function updatePassword(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const { id, email } = await requireAuth();

  const methods = await getSignInMethods(id);
  if (!methods) {
    return { status: "error", message: "Account not found" };
  }

  if (methods.hasPassword) {
    const currentPassword = formData.get("currentPassword");
    if (typeof currentPassword !== "string" || currentPassword.length === 0) {
      return { status: "error", message: "Current password is required" };
    }
    if (!(await verifyPassword(id, currentPassword))) {
      return { status: "error", message: "Current password is incorrect" };
    }
  }

  const validated = validatePassword(formData.get("newPassword"));
  if (!validated.ok) {
    return { status: "error", message: validated.message };
  }

  if (formData.get("confirmPassword") !== validated.value) {
    return { status: "error", message: "Passwords do not match" };
  }

  // Reject reusing the current password: rotating the credential to an identical
  // value changes nothing yet would still bump sessionVersion and sign out every
  // other device — surprising, and needless bcrypt work. (Only meaningful when a
  // password already exists; verifyPassword is false for Google-only accounts.)
  if (methods.hasPassword && (await verifyPassword(id, validated.value))) {
    return {
      status: "error",
      message: "Your new password must be different from your current password.",
    };
  }

  await updateCredential(id, validated.value);

  // The credential change has committed and every prior session (including this
  // device) is now invalid. Re-issue the current device so the user who made
  // the change stays signed in. If that refresh fails, the change still stands
  // and this device will simply be signed out on its next request — so report
  // success and ask the user to sign in again rather than surfacing a raw error
  // for an operation that actually succeeded.
  try {
    await refreshCurrentSession(email, validated.value);
  } catch (error) {
    console.error("Failed to refresh session after password change", error);
    revalidatePath("/account");
    return {
      status: "success",
      message: methods.hasPassword
        ? "Password updated. Please sign in again."
        : "Password set. Please sign in again.",
    };
  }

  revalidatePath("/account");
  return {
    status: "success",
    message: methods.hasPassword ? "Password updated" : "Password set",
  };
}

const BEGIN_EMAIL_CHANGE_MESSAGES: Record<BeginEmailChangeReason, string> = {
  google_linked:
    "This email cannot currently be changed because your account uses Google sign-in.",
  invalid_email: "Please enter a valid email address.",
  wrong_password: "Current password is incorrect.",
  same_email: "That is already your email address.",
  email_taken: "That email is already in use by another account.",
};

/**
 * Begin a verified email change (ADR-015).
 *
 * Orchestration only: authenticate, delegate the re-auth + token minting to the
 * emailChange service, then deliver the verification email to the NEW address.
 * Delivery is non-blocking (EmailResult, never throws) so a provider hiccup
 * can't invalidate a persisted request — the user can request another link.
 *
 * The success copy names the destination but never confirms whether it belonged
 * to an existing account (uniqueness is enforced server-side, and the link only
 * works for someone who actually controls that inbox).
 */
export async function beginEmailChange(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const { id } = await requireAuth();

  const result = await beginEmailChangeService({
    userId: id,
    newEmail: formData.get("newEmail"),
    currentPassword: formData.get("currentPassword"),
  });

  if (!result.ok) {
    return { status: "error", message: BEGIN_EMAIL_CHANGE_MESSAGES[result.reason] };
  }

  const delivery = await emailService.sendEmailChangeVerification({
    to: result.newEmail,
    verification: {
      verifyUrl: getEmailChangeVerifyUrl(result.rawToken),
      expiresAt: result.expiresAt,
    },
    userId: id,
  });

  if (delivery.status === "failed") {
    console.error("[account] email-change verification failed to send", {
      userId: id,
    });
    return {
      status: "error",
      message:
        "We couldn't send the verification email just now. Please try again in a moment.",
    };
  }

  return {
    status: "success",
    message: `Check your inbox — we've sent a verification link to ${result.newEmail}. Your sign-in email won't change until you confirm it.`,
  };
}
