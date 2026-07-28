import { prisma } from "../prisma";

/**
 * Admin Alliance Workspace Service
 *
 * Resolves where a platform operator with alliance memberships should land
 * when leaving the Platform Console. Live DB membership is the source of
 * truth — not session hints.
 */

export type AdminAllianceWorkspace =
  | { kind: "none" }
  | { kind: "single"; allianceId: string; allianceName: string; href: string }
  | { kind: "multiple"; count: number; href: string };

/**
 * Resolve the alliance workspace destination for a user.
 *
 * Returns a discriminated result so callers can render advisory nav links
 * without selecting an arbitrary "first" alliance.
 */
export async function getAdminAllianceWorkspaceDestination(
  userId: string
): Promise<AdminAllianceWorkspace> {
  const memberships = await prisma.allianceMembership.findMany({
    where: { userId },
    select: {
      allianceId: true,
      alliance: { select: { name: true } },
    },
  });

  if (memberships.length === 0) {
    return { kind: "none" };
  }

  if (memberships.length === 1) {
    const { allianceId, alliance } = memberships[0];
    return {
      kind: "single",
      allianceId,
      allianceName: alliance.name,
      href: `/alliances/${allianceId}`,
    };
  }

  return {
    kind: "multiple",
    count: memberships.length,
    href: "/alliances/select_alliance",
  };
}
