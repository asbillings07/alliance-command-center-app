"use server";

import {
  completeEmailChange,
  type CompleteEmailChangeReason,
} from "@/app/src/lib/emailChange";

export type ConfirmEmailChangeState = {
  status: "idle" | "success" | "error";
  message: string | null;
  newEmail?: string;
};

// Typed exhaustively so adding a CompleteEmailChangeReason is a compile error
// until copy exists for it (mirrors the beginEmailChange action's map).
const CONFIRM_ERROR_MESSAGES: Record<CompleteEmailChangeReason, string> = {
  invalid_or_expired:
    "This verification link is no longer valid. Please request the change again from your account page.",
  google_linked:
    "This account now uses Google sign-in, so its email can't be changed here.",
  email_taken:
    "That email was claimed by another account before you confirmed. Please request the change again.",
};

/**
 * Confirm a verified email change (ADR-015). Invoked via POST from the
 * confirmation page (never on GET) so scanners/prefetchers can't burn the
 * single-use token.
 *
 * The service performs the atomic identity swap + session revocation +
 * invitation reconciliation. Because the user's sessions are now invalid, we
 * report success here and direct them to sign in again with the new email
 * rather than redirecting into an authenticated area.
 */
export async function confirmEmailChange(
  _prev: ConfirmEmailChangeState,
  formData: FormData
): Promise<ConfirmEmailChangeState> {
  const token = formData.get("token");
  if (typeof token !== "string" || token.length === 0) {
    return { status: "error", message: CONFIRM_ERROR_MESSAGES.invalid_or_expired };
  }

  const result = await completeEmailChange(token);

  if (!result.ok) {
    return { status: "error", message: CONFIRM_ERROR_MESSAGES[result.reason] };
  }

  return {
    status: "success",
    message: null,
    newEmail: result.newEmail,
  };
}
