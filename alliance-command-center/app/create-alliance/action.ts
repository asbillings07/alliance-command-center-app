"use server";

import { redirect } from "next/navigation";
import { auth } from "@/app/src/lib/auth";
import { createAlliance } from "@/app/src/lib/createAlliance";

export type CreateAllianceState = {
  error: string | null;
};

export async function createAllianceAction(
  _prevState: CreateAllianceState,
  formData: FormData
): Promise<CreateAllianceState> {
  const session = await auth();

  if (!session?.user?.id) {
    return { error: "You must be signed in to create an alliance" };
  }

  const name = formData.get("name");
  const betaInvitationId = formData.get("betaInvitationId");

  if (!name || typeof name !== "string") {
    return { error: "Alliance name is required" };
  }

  if (!betaInvitationId || typeof betaInvitationId !== "string") {
    return { error: "Invalid beta invitation" };
  }

  try {
    const { alliance } = await createAlliance({
      name,
      userId: session.user.id,
      betaInvitationId,
    });

    redirect(`/alliances/${alliance.id}/setup`);
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "NEXT_REDIRECT") {
        throw error;
      }
      return { error: error.message };
    }
    return { error: "Failed to create alliance" };
  }
}
