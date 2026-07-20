"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import {
  getSignInMethods,
  setPassword,
  updateDisplayName,
  validateDisplayName,
  validatePassword,
  verifyPassword,
} from "@/app/src/lib/account";

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
 * bcrypt hashing and persistence stay in the account service.
 */
export async function updatePassword(
  _prev: UpdateProfileState,
  formData: FormData
): Promise<UpdateProfileState> {
  const { id } = await requireAuth();

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

  await setPassword(id, validated.value);

  revalidatePath("/account");
  return {
    status: "success",
    message: methods.hasPassword ? "Password updated" : "Password set",
  };
}
