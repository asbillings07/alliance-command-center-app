import { prisma } from "../prisma";

/**
 * Search Domain Service
 *
 * First-class search capability for the platform.
 * Enables finding alliances, users, and members quickly.
 */

export type SearchResultType = "alliance" | "user" | "member" | "invitation";

export type SearchResult = {
  id: string;
  type: SearchResultType;
  title: string;
  subtitle: string;
  href: string;
  metadata?: Record<string, unknown>;
};

export type SearchResults = {
  results: SearchResult[];
  query: string;
  totalCount: number;
};

/**
 * Search alliances by name.
 */
export async function searchAlliances(query: string): Promise<SearchResult[]> {
  if (!query || query.length < 2) return [];

  const alliances = await prisma.alliance.findMany({
    where: {
      name: { contains: query, mode: "insensitive" },
    },
    select: {
      id: true,
      name: true,
      server: true,
      _count: { select: { allianceMembers: true } },
    },
    take: 10,
  });

  return alliances.map((a) => ({
    id: a.id,
    type: "alliance" as const,
    title: a.name,
    subtitle: `${a.server} • ${a._count.allianceMembers} members`,
    href: `/platform/support/alliance/${a.id}`,
    metadata: { server: a.server, memberCount: a._count.allianceMembers },
  }));
}

/**
 * Search users by email or display name.
 */
export async function searchUsers(query: string): Promise<SearchResult[]> {
  if (!query || query.length < 2) return [];

  const users = await prisma.user.findMany({
    where: {
      OR: [
        { email: { contains: query, mode: "insensitive" } },
        { displayName: { contains: query, mode: "insensitive" } },
      ],
    },
    select: {
      id: true,
      email: true,
      displayName: true,
      memberships: {
        select: {
          role: true,
          alliance: { select: { id: true, name: true } },
        },
        take: 1,
      },
    },
    take: 10,
  });

  return users.map((u) => {
    const membership = u.memberships[0];
    return {
      id: u.id,
      type: "user" as const,
      title: u.displayName || u.email,
      subtitle: membership
        ? `${membership.role} in ${membership.alliance.name}`
        : "No alliance",
      href: membership
        ? `/platform/support/alliance/${membership.alliance.id}`
        : `/platform/beta`,
      metadata: {
        email: u.email,
        displayName: u.displayName,
        allianceId: membership?.alliance.id,
      },
    };
  });
}

/**
 * Search alliance members by player name or discord name.
 */
export async function searchMembers(query: string): Promise<SearchResult[]> {
  if (!query || query.length < 2) return [];

  const members = await prisma.allianceMember.findMany({
    where: {
      OR: [
        { playerName: { contains: query, mode: "insensitive" } },
        { discordName: { contains: query, mode: "insensitive" } },
      ],
      archivedAt: null,
    },
    include: {
      alliance: { select: { id: true, name: true } },
    },
    take: 10,
  });

  return members.map((m) => ({
    id: m.id,
    type: "member" as const,
    title: m.playerName,
    subtitle: `${m.alliance.name}${m.discordName ? ` • ${m.discordName}` : ""}`,
    href: `/alliances/${m.alliance.id}/members/${m.id}`,
    metadata: {
      allianceId: m.alliance.id,
      allianceName: m.alliance.name,
      discordName: m.discordName,
    },
  }));
}

/**
 * Search invitations by email.
 */
export async function searchInvitations(query: string): Promise<SearchResult[]> {
  if (!query || query.length < 2) return [];

  const [betaInvites, collabInvites] = await Promise.all([
    prisma.betaInvitation.findMany({
      where: {
        email: { contains: query, mode: "insensitive" },
      },
      select: {
        id: true,
        email: true,
        acceptedAt: true,
        expiresAt: true,
      },
      take: 5,
    }),
    prisma.invitation.findMany({
      where: {
        email: { contains: query, mode: "insensitive" },
      },
      include: {
        alliance: { select: { id: true, name: true } },
      },
      take: 5,
    }),
  ]);

  const results: SearchResult[] = [];

  for (const inv of betaInvites) {
    const now = new Date();
    const status = inv.acceptedAt
      ? "accepted"
      : inv.expiresAt < now
        ? "expired"
        : "pending";

    results.push({
      id: inv.id,
      type: "invitation",
      title: inv.email,
      subtitle: `Beta invitation (${status})`,
      href: `/platform/beta`,
      metadata: { status, type: "beta" },
    });
  }

  for (const inv of collabInvites) {
    const now = new Date();
    const status = inv.acceptedAt
      ? "accepted"
      : inv.expiresAt < now
        ? "expired"
        : "pending";

    results.push({
      id: inv.id,
      type: "invitation",
      title: inv.email,
      subtitle: `Collaborator for ${inv.alliance.name} (${status})`,
      href: `/alliances/${inv.alliance.id}/settings/invitations`,
      metadata: {
        status,
        type: "collaborator",
        allianceId: inv.alliance.id,
        allianceName: inv.alliance.name,
      },
    });
  }

  return results;
}

/**
 * Unified search across all platform entities.
 */
export async function searchPlatform(query: string): Promise<SearchResults> {
  if (!query || query.length < 2) {
    return { results: [], query, totalCount: 0 };
  }

  const [alliances, users, members, invitations] = await Promise.all([
    searchAlliances(query),
    searchUsers(query),
    searchMembers(query),
    searchInvitations(query),
  ]);

  const results = [...alliances, ...users, ...members, ...invitations];

  return {
    results,
    query,
    totalCount: results.length,
  };
}
