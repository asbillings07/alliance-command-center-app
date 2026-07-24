import { prisma } from "@/app/src/lib/prisma";
import {
  getPendingAllianceCreation,
  getPendingInvitation,
} from "@/app/src/lib/betaInvitation";
import { getAllianceSetupStatus } from "@/app/src/lib/allianceSetup";
import { isPlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { AllianceRole } from "@/app/generated/prisma/enums";
import { normalizeEmail } from "@/app/src/lib/email/normalize";

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
 *   1. A pending beta invitation                    -> /redeem
 *   2. Onboarding: accepted a beta, no alliance yet -> /create-alliance
 *   3. Platform operator with no pending work       -> /platform/overview
 *   4. Alliance membership                          -> alliance home / setup / selector
 *   5. A pending alliance collaborator invitation   -> /invite/{token}
 *   6. Nothing else actionable                      -> /redeem
 */
export async function getPostLoginRedirect(
  user: PostLoginUser
): Promise<string> {
  // 1. Pending BETA invitation: invited to the beta but not yet redeemed at
  //    /redeem (the beta-code page). Scope this strictly to beta invitations -
  //    alliance collaborator invites are a different flow entirely (step 5),
  //    so isInvitationEligible (which also matches alliance invites) is too
  //    broad here and would mis-route those users to the beta page.
  if (user.email && (await getPendingInvitation(user.email))) {
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
  //
  //    The session hint is a routing optimization, but /platform/* enforces
  //    admin from the DB (requirePlatformAdmin). If admin was revoked mid-
  //    session the hint goes stale, and trusting it here would ping-pong the
  //    user between /app -> /platform/overview -> /app forever. So when the
  //    hint says "admin", confirm against the DB before committing to the
  //    protected destination; a demoted user falls through to their real
  //    state below. The lookup only happens for hinted admins.
  if (user.isPlatformAdmin && (await isPlatformAdmin(user.id))) {
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

  // 5. Pending alliance collaborator invitation -> the invite acceptance flow,
  //    not the beta /redeem page. Only reached when the user has no membership
  //    (the returns above), so we never hijack an existing member's landing.
  if (user.email) {
    const allianceInvite = await prisma.invitation.findFirst({
      where: {
        email: normalizeEmail(user.email),
        acceptedAt: null,
        cancelledAt: null,
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: "desc" },
      select: { token: true },
    });
    if (allianceInvite) {
      return `/invite/${allianceInvite.token}`;
    }
  }

  // 6. Nothing actionable and no alliance: fall back to redeem.
  return "/redeem";
}
