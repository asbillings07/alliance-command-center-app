"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { signIn } from "@/app/src/lib/auth";
import {
  getSessionVersion,
  refreshCurrentSession,
} from "@/app/src/lib/auth/session";
import { isGoogleAuthEnabled } from "@/app/src/lib/auth/identity/google";
import {
  clearConnectResult,
  disconnectGoogle as disconnectGoogleService,
  logGoogleConnectionEvent,
  setLinkIntent,
} from "@/app/src/lib/auth/googleConnection";
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
  discardEmailChangeRequest,
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

  // "skipped" means email isn't configured. Locally/CI that's expected (the
  // link is logged), but in production it means the user would never receive a
  // link — treat it as a delivery failure there rather than lying "check your
  // inbox".
  const deliveryFailed =
    delivery.status === "failed" ||
    (delivery.status === "skipped" && process.env.NODE_ENV === "production");

  if (deliveryFailed) {
    // Nothing was verifiable — discard the request we just created rather than
    // leaving an orphaned pending row behind. Best-effort: cleanup failure must
    // not turn a delivery problem into a 500, and the row would simply expire or
    // be superseded anyway.
    try {
      await discardEmailChangeRequest(result.requestId);
    } catch (cleanupError) {
      console.error("[account] failed to discard email-change request", {
        userId: id,
        cleanupError,
      });
    }
    console.error("[account] email-change verification not delivered", {
      userId: id,
      status: delivery.status,
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

/**
 * Begin an explicit Google connect (#131).
 *
 * Mints a signed, session-bound link intent tied to the current user, then
 * starts the Google OAuth challenge. The intent (not an email match) is what
 * binds the returning Google subject to this account, so connect is correct even
 * when the app email and the Google email differ. On return the signIn callback
 * verifies the intent and links; the outcome is surfaced as a banner on
 * /account via the read-once result cookie.
 */
export async function connectGoogle(): Promise<void> {
  const { id } = await requireAuth();

  // The Google provider is only registered when OAuth is configured; guard
  // against a stale UI / direct POST so we bounce back rather than 500.
  if (!isGoogleAuthEnabled()) {
    redirect("/account");
  }

  // Bind the intent to the current session version so a password change or
  // revocation mid-round-trip invalidates it.
  const sessionVersion = await getSessionVersion(id);
  if (sessionVersion === null) {
    redirect("/login");
  }

  await setLinkIntent({ userId: id, sessionVersion });

  // signIn redirects to Google (throws NEXT_REDIRECT); control does not return.
  await signIn("google", { redirectTo: "/account" });
}

const DISCONNECT_GOOGLE_MESSAGES = {
  no_password:
    "Set a password before disconnecting Google, so you don't lose access to your account.",
  not_connected: "Google isn't connected to your account.",
  incorrect_password: "Password is incorrect.",
  password_required: "Enter your password to disconnect Google.",
  not_found: "Account not found.",
} as const;

/**
 * Disconnect Google from the signed-in user (#131).
 *
 * Requires current-password re-authentication (a destructive identity change)
 * and refuses when Google is the only sign-in method (lockout safety) — enforced
 * again in the domain service as defense in depth. Does not revoke sessions: the
 * user chose to manage their own account.
 */
export async function disconnectGoogle(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const { id } = await requireAuth();

  const methods = await getSignInMethods(id);
  if (!methods) {
    return { status: "error", message: DISCONNECT_GOOGLE_MESSAGES.not_found };
  }
  if (!methods.hasGoogle) {
    return {
      status: "error",
      message: DISCONNECT_GOOGLE_MESSAGES.not_connected,
    };
  }
  // Lockout guard: without a password, disconnecting would remove the last
  // sign-in method. The UI disables this, but never trust the client.
  if (!methods.hasPassword) {
    logGoogleConnectionEvent("disconnect_denied", {
      userId: id,
      reason: "no_password",
    });
    return { status: "error", message: DISCONNECT_GOOGLE_MESSAGES.no_password };
  }

  const currentPassword = formData.get("currentPassword");
  if (typeof currentPassword !== "string" || currentPassword.length === 0) {
    return {
      status: "error",
      message: DISCONNECT_GOOGLE_MESSAGES.password_required,
    };
  }
  if (!(await verifyPassword(id, currentPassword))) {
    return {
      status: "error",
      message: DISCONNECT_GOOGLE_MESSAGES.incorrect_password,
    };
  }

  const result = await disconnectGoogleService(id);

  switch (result.status) {
    case "success":
      logGoogleConnectionEvent("disconnected", { userId: id });
      revalidatePath("/account");
      return {
        status: "success",
        message: "Google has been disconnected from your account.",
      };
    case "no_password":
      logGoogleConnectionEvent("disconnect_denied", {
        userId: id,
        reason: "no_password",
      });
      return {
        status: "error",
        message: DISCONNECT_GOOGLE_MESSAGES.no_password,
      };
    case "not_connected":
      return {
        status: "error",
        message: DISCONNECT_GOOGLE_MESSAGES.not_connected,
      };
  }
}

/**
 * Acknowledge (clear) the read-once Google connect-result banner cookie.
 *
 * Reading happens during the /account server render (safe), but a cookie can
 * only be *cleared* from an action/route handler — so the banner triggers this
 * on mount. Clearing the caller's own transient banner cookie is harmless, so
 * it needs no re-auth.
 */
export async function acknowledgeGoogleConnectResult(): Promise<void> {
  await clearConnectResult();
}
