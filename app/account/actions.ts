"use server";

import { revalidatePath } from "next/cache";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { updateDisplayName, validateDisplayName } from "@/app/src/lib/account";

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
