import { prisma } from "@/app/src/lib/prisma";
import { getPendingAllianceCreation } from "@/app/src/lib/betaInvitation";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import { AllianceRole } from "@/app/generated/prisma/enums";

/**
 * Resolve where a freshly authenticated user belongs, based on their current
 * state.
 *
 * This is the single source of truth for post-login routing. The auth layer
 * only performs the redirect; it does not decide *why* a user lands somewhere.
 * As onboarding grows (pending invites, multi-alliance selection, future
 * onboarding steps), this is the one place that decision evolves - callers stay
 * ignorant of the rules.
 *
 * Order matters: the most specific state wins.
 */
export async function getPostLoginRedirect(userId: string): Promise<string> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { isPlatformAdmin: true },
  });

  // Platform operators land in the operations center, not an alliance flow.
  if (user?.isPlatformAdmin) {
    return "/platform/overview";
  }

  const memberships = await prisma.allianceMembership.findMany({
    where: { userId },
    select: { allianceId: true, role: true },
    take: 2,
  });

  if (memberships.length === 0) {
    // No alliance yet: either finish creating the one they were invited to
    // provision, or redeem an invitation to get started.
    const pendingCreation = await getPendingAllianceCreation(userId);
    return pendingCreation ? "/create-alliance" : "/redeem";
  }

  if (memberships.length === 1) {
    const { allianceId, role } = memberships[0];

    // Only owners are routed to setup, and only while it is incomplete.
    // Collaborators can't complete owner tasks, so they go straight in.
    if (role === AllianceRole.OWNER) {
      const status = await getAllianceSetupStatus(allianceId);
      if (!status.isComplete) {
        return `/alliances/${allianceId}/setup`;
      }
    }

    return `/alliances/${allianceId}`;
  }

  return "/alliances/select_alliance";
}
