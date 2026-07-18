"use server";

import { createAccessRequest } from "@/app/src/lib/accessRequest";
import { emailService } from "@/app/src/lib/email";

export type RequestAccessState = {
  status: "idle" | "success" | "error";
  error: string | null;
};

// Deliberately permissive: just enough to catch obvious typos without rejecting
// valid-but-unusual addresses. The real validation is that we can email them.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Handle a beta access request.
 *
 * Persists the interest, then (best-effort) sends a confirmation email. Email
 * delivery is non-blocking and never fails the request: the record is the
 * source of truth, the email is only a courtesy — the same pattern used for
 * every other transactional email (ADR-014).
 */
export async function requestAccess(
  _prevState: RequestAccessState,
  formData: FormData
): Promise<RequestAccessState> {
  const name = formData.get("name")?.toString().trim();
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const allianceName = formData.get("allianceName")?.toString();
  const message = formData.get("message")?.toString();

  if (!name || !email) {
    return { status: "error", error: "Name and email are required." };
  }

  if (!EMAIL_PATTERN.test(email)) {
    return { status: "error", error: "Please enter a valid email address." };
  }

  let accessRequestId: string;
  try {
    const created = await createAccessRequest({
      name,
      email,
      allianceName,
      message,
    });
    accessRequestId = created.id;
  } catch (error) {
    console.error("[access-request] failed to persist request", error);
    return {
      status: "error",
      error: "Something went wrong. Please try again in a moment.",
    };
  }

  // Best-effort confirmation. deliverEmail never throws, but guard anyway so a
  // notification problem can never turn a captured request into a user error.
  try {
    await emailService.sendAccessRequestConfirmation({
      to: email,
      request: { name },
      accessRequestId,
    });
  } catch (error) {
    console.error("[access-request] confirmation email failed", error);
  }

  return { status: "success", error: null };
}
