"use server";

import { redirect } from "next/navigation";
import { resetPassword } from "@/app/src/lib/passwordReset";

export type ResetPasswordState = {
  error: string | null;
};

/**
 * Set a new password from a reset link.
 *
 * The action handles only the form concern (confirm-password match) and then
 * delegates every token/password invariant to the domain service, which does
 * the work in one transaction (including revoking existing sessions). On success
 * it redirects to the login page.
 */
export async function resetPasswordAction(
  _prevState: ResetPasswordState,
  formData: FormData
): Promise<ResetPasswordState> {
  const token = formData.get("token")?.toString() ?? "";
  const password = formData.get("password")?.toString() ?? "";
  const confirmPassword = formData.get("confirmPassword")?.toString() ?? "";

  if (!token) {
    return { error: "Invalid or missing reset token" };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  const result = await resetPassword(token, password);

  if (result.status === "invalid_password") {
    return { error: result.message };
  }

  if (result.status === "invalid_token") {
    return {
      error:
        "This reset link is invalid or has expired. Please request a new one.",
    };
  }

  redirect("/login?reset=success");
}
