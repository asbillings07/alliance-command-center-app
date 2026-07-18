import { prisma } from "@/app/src/lib/prisma";
import { getPendingAllianceCreation } from "@/app/src/lib/betaInvitation";
import { isInvitationEligible } from "@/app/src/lib/auth/identity/eligibility";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import { AllianceRole } from "@/app/generated/prisma/enums";

/**
 * The already-authenticated user, as known from the session. `isPlatformAdmin`
 * is a session hint (see next-auth.d.ts): fine for routing, never for access
 * control. Passing this in keeps /app from issuing an extra DB round-trip on
 * every visit just to re-read fields the session already carries.
 */
export type PostLoginUser = {
  id: string;
  email?: string | null;
  isPlatformAdmin?: boolean;
};

/**
 * Resolve where a freshly authenticated user belongs.
 *
 * The question this answers is "what is the highest-priority action this user
 * needs to take right now?" - decided from their *state*, not their identity.
 * A single account may simultaneously be a platform admin, an alliance member,
 * and an invitee; role is one input into the decision, never the decision
 * itself. (In particular, the operator often signs in to test as a normal user,
 * so we must not let "is admin" short-circuit real pending work.)
 *
 * Priority, most urgent first:
 *   1. A pending invitation to redeem              -> /redeem
 *   2. Onboarding: accepted a beta, no alliance yet -> /create-alliance
 *   3. Platform operator with no pending work       -> /platform/overview
 *   4. Alliance membership                          -> alliance home / setup / selector
 *   5. Nothing else actionable                      -> /redeem
 */
export async function getPostLoginRedirect(
  user: PostLoginUser
): Promise<string> {
  // 1. Pending invitation: invited but not yet redeemed. Actionable work that
  //    takes precedence over any role or existing context.
  if (user.email && (await isInvitationEligible(user.email))) {
    return "/redeem";
  }

  // 2. Onboarding: accepted a beta invite but hasn't created their alliance yet.
  const pendingCreation = await getPendingAllianceCreation(user.id);
  if (pendingCreation) {
    return "/create-alliance";
  }

  // 3. Platform operator with no pending work lands in the operations center.
  //    Checked after actionable work (so testing as a normal user still routes
  //    by state) but before alliance context, so the operator defaults to the
  //    console rather than an alliance they happen to belong to. Role is an
  //    input here, not the routing mechanism.
  if (user.isPlatformAdmin) {
    return "/platform/overview";
  }

  // 4. Alliance membership.
  const memberships = await prisma.allianceMembership.findMany({
    where: { userId: user.id },
    select: { allianceId: true, role: true },
    take: 2,
  });

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

  if (memberships.length > 1) {
    return "/alliances/select_alliance";
  }

  // 5. Nothing actionable and no alliance: fall back to redeem.
  return "/redeem";
}
