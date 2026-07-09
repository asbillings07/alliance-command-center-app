"use server";
/**
 * Validate input
 * Create Alliance
 * Create AllianceMember (roster entry for owner, linked via userId)
 * Create AllianceMembership (access/permissions)
 * Redirect /app
 */
import { auth } from "@/app/src/lib/auth";
import { prisma } from "@/app/src/lib/prisma";
import { redirect } from "next/navigation";

export type OnboardingState = {
  error: string | null;
};

export async function onboarding(
  _prevState: OnboardingState,
  formData: FormData,
): Promise<OnboardingState> {
  //1. Verify authenticated user
  const session = await auth();
  if (!session || !session.user?.id) {
    redirect("/login");
  }
  const userId = session.user.id;
  //2. Validate alliance name
  const allianceName = formData
    .get("allianceName")
    ?.toString()
    .toUpperCase()
    .trim();
  if (!allianceName || allianceName.length < 3 || allianceName.length > 20) {
    return { error: "Alliance name must be between 3 and 20 characters" };
  }
  const allianceServerNumber = formData
    .get("allianceServerNumber")
    ?.toString()
    .trim();
  if (
    !allianceServerNumber ||
    allianceServerNumber.length < 1 ||
    allianceServerNumber.length > 7
  ) {
    return {
      error: "Alliance server number must be between 1 and 7 characters",
    };
  }
  if (!/^\d+$/.test(allianceServerNumber)) {
    return {
      error: "Server number must contain only digits",
    };
  }

  //3. Does this alliance already exist?
  const alliance = await prisma.alliance.findUnique({
    where: {
      name_server: {
        name: allianceName,
        server: allianceServerNumber,
      },
    },
  });

  //4. Check if alliance already exists
  if (alliance) {
    //5. If it exists return the user with an error message
    return {
      error: "An alliance with that name already exists on this server",
    };
  }

  try {
    //6. Get user's display name for roster entry
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true },
    });
    
    if (!user) {
      return { error: "User not found" };
    }

    //7. Create Alliance + AllianceMembership + AllianceMember inside a transaction
    await prisma.$transaction(async (tx) => {
      const alliance = await tx.alliance.create({
        data: {
          name: allianceName,
          server: allianceServerNumber,
        },
      });

      // Create roster entry for the owner (linked to their user account)
      await tx.allianceMember.create({
        data: {
          allianceId: alliance.id,
          playerName: user.displayName,
          userId: userId,
        },
      });

      await tx.allianceMembership.create({
        data: {
          allianceId: alliance.id,
          userId: userId,
          role: "OWNER",
        },
      });
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code?: string }).code === "P2002"
    ) {
      return {
        error: "An alliance with that name already exists on this server.",
      };
    }
    console.error("Error creating alliance", error);
    return { error: "Error creating alliance" };
  }

  redirect("/app");
  //7. Redirect /app
}
