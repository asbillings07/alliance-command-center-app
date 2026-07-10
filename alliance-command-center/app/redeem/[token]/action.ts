"use server";

import { redirect } from "next/navigation";
import { auth } from "@/app/src/lib/auth";
import { acceptBetaInvitation as acceptInvitation } from "@/app/src/lib/betaInvitation";

export type AcceptState = {
  error: string | null;
};

export async function acceptBetaInvitation(
  _prevState: AcceptState,
  formData: FormData
): Promise<AcceptState> {
  const session = await auth();

  if (!session?.user?.id) {
    return { error: "You must be signed in to accept this invitation" };
  }

  const invitationId = formData.get("invitationId");

  if (!invitationId || typeof invitationId !== "string") {
    return { error: "Invalid invitation" };
  }

  try {
    await acceptInvitation(invitationId, session.user.id);
  } catch (error) {
    if (error instanceof Error) {
      return { error: error.message };
    }
    return { error: "Failed to accept invitation" };
  }

  redirect("/create-alliance");
}
