import { prisma } from "./prisma";

/**
 * Beta Dashboard Service
 *
 * Provides operational visibility into beta progress.
 * Focused on answering "How is beta going?" with actionable metrics.
 */

export type FunnelStage = {
  label: string;
  count: number;
};

export type AllianceReadiness = {
  ready: number;
  needsSetup: number;
  new: number;
};

export type NeedsAttentionItem = {
  type: "stuck_alliance" | "expired_invitation";
  id: string;
  label: string;
  detail: string;
  daysSinceActivity?: number;
};

export type BetaStats = {
  alliances: {
    total: number;
    activeToday: number;
    newThisWeek: number;
  };
  users: {
    total: number;
    owners: number;
    admins: number;
    leaders: number;
    viewers: number;
  };
  funnel: FunnelStage[];
  readiness: AllianceReadiness;
  needsAttention: NeedsAttentionItem[];
  recentActivity: RecentActivityItem[];
};

export type RecentActivityItem = {
  allianceName: string;
  description: string;
  timestamp: Date;
};

async function getAllianceStats() {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  const [total, newThisWeek, activeToday] = await Promise.all([
    prisma.alliance.count(),
    prisma.alliance.count({
      where: { createdAt: { gte: weekAgo } },
    }),
    prisma.alliance.count({
      where: {
        OR: [
          { allianceMembers: { some: { createdAt: { gte: todayStart } } } },
          {
            allianceMembers: {
              some: {
                metricEntries: { some: { recordedAt: { gte: todayStart } } },
              },
            },
          },
        ],
      },
    }),
  ]);

  return { total, activeToday, newThisWeek };
}

async function getUserStats() {
  const [total, owners, admins, leaders, viewers] = await Promise.all([
    prisma.user.count(),
    prisma.allianceMembership.count({ where: { role: "OWNER" } }),
    prisma.allianceMembership.count({ where: { role: "ADMIN" } }),
    prisma.allianceMembership.count({ where: { role: "LEADER" } }),
    prisma.allianceMembership.count({ where: { role: "VIEWER" } }),
  ]);

  return { total, owners, admins, leaders, viewers };
}

async function getFunnelStats(): Promise<FunnelStage[]> {
  const [
    betaInvitesSent,
    betaInvitesAccepted,
    alliancesCreated,
    alliancesWithMetrics,
    alliancesWithMembers,
    alliancesWithData,
    collaboratorsInvited,
    collaboratorsAccepted,
  ] = await Promise.all([
    prisma.betaInvitation.count(),
    prisma.betaInvitation.count({ where: { acceptedAt: { not: null } } }),
    prisma.alliance.count(),
    prisma.alliance.count({
      where: { metrics: { some: {} } },
    }),
    prisma.alliance.count({
      where: { allianceMembers: { some: { archivedAt: null } } },
    }),
    prisma.alliance.count({
      where: {
        allianceMembers: {
          some: { metricEntries: { some: {} } },
        },
      },
    }),
    prisma.invitation.count(),
    prisma.invitation.count({ where: { acceptedAt: { not: null } } }),
  ]);

  return [
    { label: "Beta Invited", count: betaInvitesSent },
    { label: "Beta Accepted", count: betaInvitesAccepted },
    { label: "Alliance Created", count: alliancesCreated },
    { label: "Invited Collaborator", count: collaboratorsInvited },
    { label: "Collaborator Accepted", count: collaboratorsAccepted },
    { label: "Metrics Configured", count: alliancesWithMetrics },
    { label: "Members Imported", count: alliancesWithMembers },
    { label: "First Dataset Imported", count: alliancesWithData },
  ];
}

async function getAllianceReadiness(): Promise<AllianceReadiness> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const allAlliances = await prisma.alliance.findMany({
    select: {
      id: true,
      createdAt: true,
      _count: {
        select: {
          metrics: true,
          metricPeriods: true,
          allianceMembers: true,
        },
      },
      allianceMembers: {
        select: {
          _count: { select: { metricEntries: true } },
        },
      },
    },
  });

  let ready = 0;
  let needsSetup = 0;
  let newCount = 0;

  for (const alliance of allAlliances) {
    const hasMetrics = alliance._count.metrics > 0;
    const hasPeriods = alliance._count.metricPeriods > 0;
    const hasMembers = alliance._count.allianceMembers > 0;
    const hasData = alliance.allianceMembers.some(
      (m) => m._count.metricEntries > 0
    );

    const isComplete = hasMetrics && hasPeriods && hasMembers && hasData;
    const isNew = alliance.createdAt >= weekAgo;

    if (isNew) {
      newCount++;
    } else if (isComplete) {
      ready++;
    } else {
      needsSetup++;
    }
  }

  return { ready, needsSetup, new: newCount };
}

async function getNeedsAttention(): Promise<NeedsAttentionItem[]> {
  const items: NeedsAttentionItem[] = [];
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // Stuck alliances: created > 7 days ago, no metric entries
  const stuckAlliances = await prisma.alliance.findMany({
    where: {
      createdAt: { lt: weekAgo },
      allianceMembers: {
        none: { metricEntries: { some: {} } },
      },
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: {
        select: { metrics: true, allianceMembers: true },
      },
    },
    take: 10,
    orderBy: { createdAt: "asc" },
  });

  for (const alliance of stuckAlliances) {
    const daysSinceCreation = Math.floor(
      (now.getTime() - alliance.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    items.push({
      type: "stuck_alliance",
      id: alliance.id,
      label: alliance.name,
      detail: `${alliance._count.metrics} metrics, ${alliance._count.allianceMembers} members, no data`,
      daysSinceActivity: daysSinceCreation,
    });
  }

  // Expired beta invitations
  const expiredInvitations = await prisma.betaInvitation.findMany({
    where: {
      expiresAt: { lt: now },
      acceptedAt: null,
    },
    select: {
      id: true,
      email: true,
      expiresAt: true,
    },
    take: 10,
    orderBy: { expiresAt: "desc" },
  });

  for (const inv of expiredInvitations) {
    const daysSinceExpired = Math.floor(
      (now.getTime() - inv.expiresAt.getTime()) / (1000 * 60 * 60 * 24)
    );
    items.push({
      type: "expired_invitation",
      id: inv.id,
      label: inv.email,
      detail: `Expired ${daysSinceExpired} day${daysSinceExpired === 1 ? "" : "s"} ago`,
    });
  }

  return items;
}

async function getRecentActivity(): Promise<RecentActivityItem[]> {
  const items: RecentActivityItem[] = [];

  // Recent metric entries
  const recentEntries = await prisma.memberMetricEntry.findMany({
    take: 5,
    orderBy: { recordedAt: "desc" },
    select: {
      recordedAt: true,
      allianceMember: {
        select: {
          alliance: { select: { name: true } },
        },
      },
    },
  });

  for (const entry of recentEntries) {
    items.push({
      allianceName: entry.allianceMember.alliance.name,
      description: "Recorded metrics",
      timestamp: entry.recordedAt,
    });
  }

  // Recent alliance creations
  const recentAlliances = await prisma.alliance.findMany({
    take: 5,
    orderBy: { createdAt: "desc" },
    select: {
      name: true,
      createdAt: true,
    },
  });

  for (const alliance of recentAlliances) {
    items.push({
      allianceName: alliance.name,
      description: "Alliance created",
      timestamp: alliance.createdAt,
    });
  }

  // Sort by timestamp descending and take top 10
  items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  return items.slice(0, 10);
}

/**
 * Get all beta statistics for the admin dashboard.
 *
 * This is an operational dashboard focused on:
 * - "How is beta going?"
 * - "Who's stuck?"
 * - "Do I need to intervene?"
 */
export async function getBetaStats(): Promise<BetaStats> {
  const [alliances, users, funnel, readiness, needsAttention, recentActivity] =
    await Promise.all([
      getAllianceStats(),
      getUserStats(),
      getFunnelStats(),
      getAllianceReadiness(),
      getNeedsAttention(),
      getRecentActivity(),
    ]);

  return {
    alliances,
    users,
    funnel,
    readiness,
    needsAttention,
    recentActivity,
  };
}
