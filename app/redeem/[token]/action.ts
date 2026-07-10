"use server";

import { redirect } from "next/navigation";
import { auth } from "@/app/src/lib/auth";
import { prisma } from "@/app/src/lib/prisma";
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

  // Get full user record to verify email
  const user = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { email: true },
  });

  if (!user) {
    return { error: "User not found" };
  }

  // Get invitation to verify email matches
  const invitation = await prisma.betaInvitation.findUnique({
    where: { id: invitationId },
  });

  if (!invitation) {
    return { error: "Invitation not found" };
  }

  // Verify the authenticated user's email matches the invitation
  if (invitation.email.toLowerCase() !== user.email.toLowerCase()) {
    return { error: "This invitation was sent to a different email address" };
  }

  if (invitation.acceptedAt) {
    return { error: "This invitation has already been accepted" };
  }

  if (invitation.expiresAt < new Date()) {
    return { error: "This invitation has expired" };
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
