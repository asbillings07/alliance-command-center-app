import { prisma } from "../prisma";

/**
 * Setup Domain Service
 *
 * Provides queries for tracking setup progress and funnel.
 */

export type FunnelStage = {
  label: string;
  count: number;
  percentage: number;
};

export type SetupFunnel = {
  stages: FunnelStage[];
  maxCount: number;
};

/**
 * Get the setup funnel stages.
 */
export async function getSetupFunnel(): Promise<SetupFunnel> {
  const [
    betaInvitesSent,
    betaInvitesAccepted,
    alliancesCreated,
    alliancesWithMetrics,
    alliancesWithPeriods,
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
      where: { metricPeriods: { some: {} } },
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
    prisma.alliance.count({
      where: { invitations: { some: {} } },
    }),
    prisma.alliance.count({
      where: { invitations: { some: { acceptedAt: { not: null } } } },
    }),
  ]);

  // Use max across all stages to prevent percentages > 100%
  const allCounts = [
    betaInvitesSent,
    betaInvitesAccepted,
    alliancesCreated,
    alliancesWithMetrics,
    alliancesWithPeriods,
    alliancesWithMembers,
    alliancesWithData,
    collaboratorsInvited,
    collaboratorsAccepted,
  ];
  const maxCount = Math.max(...allCounts, 1);

  const stages: FunnelStage[] = [
    {
      label: "Beta Invited",
      count: betaInvitesSent,
      percentage: (betaInvitesSent / maxCount) * 100,
    },
    {
      label: "Beta Accepted",
      count: betaInvitesAccepted,
      percentage: (betaInvitesAccepted / maxCount) * 100,
    },
    {
      label: "Alliance Created",
      count: alliancesCreated,
      percentage: (alliancesCreated / maxCount) * 100,
    },
    {
      label: "Metrics Configured",
      count: alliancesWithMetrics,
      percentage: (alliancesWithMetrics / maxCount) * 100,
    },
    {
      label: "Period Created",
      count: alliancesWithPeriods,
      percentage: (alliancesWithPeriods / maxCount) * 100,
    },
    {
      label: "Roster Imported",
      count: alliancesWithMembers,
      percentage: (alliancesWithMembers / maxCount) * 100,
    },
    {
      label: "Evaluation Results Imported",
      count: alliancesWithData,
      percentage: (alliancesWithData / maxCount) * 100,
    },
    {
      label: "Invited Collaborator",
      count: collaboratorsInvited,
      percentage: (collaboratorsInvited / maxCount) * 100,
    },
    {
      label: "Collaborator Accepted",
      count: collaboratorsAccepted,
      percentage: (collaboratorsAccepted / maxCount) * 100,
    },
  ];

  return { stages, maxCount };
}

/**
 * Get stalled alliances (no activity in 7+ days, setup incomplete).
 */
export async function getStalledAlliances() {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  return prisma.alliance.findMany({
    where: {
      createdAt: { lt: weekAgo },
      OR: [
        { metrics: { none: {} } },
        { metricPeriods: { none: {} } },
        { allianceMembers: { none: { archivedAt: null } } },
        {
          allianceMembers: {
            none: { metricEntries: { some: {} } },
          },
        },
      ],
    },
    select: {
      id: true,
      name: true,
      createdAt: true,
      // Include active members for accurate count (not _count which includes archived)
      allianceMembers: {
        where: { archivedAt: null },
        select: { id: true },
      },
      _count: {
        select: {
          metrics: true,
          metricPeriods: true,
        },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Get new alliances created in the last 7 days.
 */
export async function getNewAlliances() {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  return prisma.alliance.findMany({
    where: { createdAt: { gte: weekAgo } },
    select: {
      id: true,
      name: true,
      createdAt: true,
      _count: {
        select: {
          metrics: true,
          metricPeriods: true,
          allianceMembers: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}
