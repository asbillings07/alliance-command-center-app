import { prisma } from "../prisma";

/**
 * Invitations Domain Service
 *
 * Provides queries for beta and collaborator invitations.
 */

export type BetaInvitationStatus = "pending" | "accepted" | "expired" | "revoked";

export type BetaInvitationItem = {
  id: string;
  email: string;
  code: string;
  token: string;
  inviteUrl: string;
  notes: string | null;
  status: BetaInvitationStatus;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  hasAlliance: boolean;
  allianceId: string | null;
  allianceName: string | null;
};

export type CollaboratorInvitationItem = {
  id: string;
  email: string;
  allianceId: string;
  allianceName: string;
  role: string;
  createdAt: Date;
  expiresAt: Date;
  acceptedAt: Date | null;
  status: "pending" | "accepted" | "expired";
};

export type InvitationStats = {
  betaInvites: {
    total: number;
    pending: number;
    accepted: number;
    expired: number;
    revoked: number;
  };
  collaboratorInvites: {
    total: number;
    pending: number;
    accepted: number;
    expired: number;
  };
};

/**
 * Get the base URL for invite links.
 * Uses NEXTAUTH_URL for consistency with invitation creation.
 */
function getInviteOrigin(): string {
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("NEXTAUTH_URL must be configured in production");
    }
    return "http://localhost:3000";
  }
  return origin;
}

/**
 * Get all beta invitations.
 */
export async function getBetaInvitations(): Promise<BetaInvitationItem[]> {
  const now = new Date();
  const origin = getInviteOrigin();

  const invitations = await prisma.betaInvitation.findMany({
    orderBy: { createdAt: "desc" },
  });

  const users = await prisma.user.findMany({
    where: {
      email: { in: invitations.map((i) => i.email) },
    },
    select: {
      email: true,
      memberships: {
        select: {
          alliance: { select: { id: true, name: true } },
        },
        where: { role: "OWNER" },
        take: 1,
      },
    },
  });

  const userMap = new Map(
    users.map((u) => [
      u.email,
      u.memberships[0]
        ? {
            allianceId: u.memberships[0].alliance.id,
            allianceName: u.memberships[0].alliance.name,
          }
        : null,
    ])
  );

  return invitations.map((inv) => {
    let status: BetaInvitationStatus;
    if (inv.acceptedAt) {
      status = "accepted";
    } else if (inv.revokedAt) {
      status = "revoked";
    } else if (inv.expiresAt < now) {
      status = "expired";
    } else {
      status = "pending";
    }

    const alliance = userMap.get(inv.email);

    return {
      id: inv.id,
      email: inv.email,
      code: inv.code,
      token: inv.token,
      inviteUrl: `${origin}/redeem/${inv.token}`,
      notes: inv.notes,
      status,
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      hasAlliance: !!alliance,
      allianceId: alliance?.allianceId || null,
      allianceName: alliance?.allianceName || null,
    };
  });
}

/**
 * Get all collaborator invitations.
 */
export async function getCollaboratorInvitations(): Promise<
  CollaboratorInvitationItem[]
> {
  const now = new Date();

  const invitations = await prisma.invitation.findMany({
    include: {
      alliance: { select: { id: true, name: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return invitations.map((inv) => {
    let status: "pending" | "accepted" | "expired";
    if (inv.acceptedAt) {
      status = "accepted";
    } else if (inv.expiresAt < now) {
      status = "expired";
    } else {
      status = "pending";
    }

    return {
      id: inv.id,
      email: inv.email,
      allianceId: inv.alliance.id,
      allianceName: inv.alliance.name,
      role: inv.membershipRole,
      createdAt: inv.createdAt,
      expiresAt: inv.expiresAt,
      acceptedAt: inv.acceptedAt,
      status,
    };
  });
}

/**
 * Get invitation statistics.
 */
export async function getInvitationStats(): Promise<InvitationStats> {
  const now = new Date();

  const [
    betaTotal,
    betaPending,
    betaAccepted,
    betaExpired,
    betaRevoked,
    collabTotal,
    collabPending,
    collabAccepted,
    collabExpired,
  ] = await Promise.all([
    prisma.betaInvitation.count(),
    prisma.betaInvitation.count({
      where: {
        acceptedAt: null,
        revokedAt: null,
        expiresAt: { gte: now },
      },
    }),
    prisma.betaInvitation.count({ where: { acceptedAt: { not: null } } }),
    prisma.betaInvitation.count({
      where: { acceptedAt: null, revokedAt: null, expiresAt: { lt: now } },
    }),
    prisma.betaInvitation.count({ where: { revokedAt: { not: null } } }),
    prisma.invitation.count(),
    prisma.invitation.count({
      where: { acceptedAt: null, cancelledAt: null, expiresAt: { gte: now } },
    }),
    prisma.invitation.count({ where: { acceptedAt: { not: null } } }),
    prisma.invitation.count({
      where: { acceptedAt: null, cancelledAt: null, expiresAt: { lt: now } },
    }),
  ]);

  return {
    betaInvites: {
      total: betaTotal,
      pending: betaPending,
      accepted: betaAccepted,
      expired: betaExpired,
      revoked: betaRevoked,
    },
    collaboratorInvites: {
      total: collabTotal,
      pending: collabPending,
      accepted: collabAccepted,
      expired: collabExpired,
    },
  };
}

/**
 * Get count of pending beta invitations that were accepted but user hasn't created an alliance.
 */
export async function getAcceptedWithoutAlliance(): Promise<number> {
  const acceptedInvitations = await prisma.betaInvitation.findMany({
    where: { acceptedAt: { not: null } },
    select: { email: true },
  });

  const emails = acceptedInvitations.map((i) => i.email);

  const usersWithAlliances = await prisma.user.count({
    where: {
      email: { in: emails },
      memberships: { some: { role: "OWNER" } },
    },
  });

  return acceptedInvitations.length - usersWithAlliances;
}
