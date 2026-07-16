import { prisma } from "../prisma";

/**
 * Alliance Domain Service
 *
 * Provides queries for alliance-related platform operations.
 * Reusable across Overview, Setup, and Support workflows.
 */

export type AllianceFilters = {
  status?: "ready" | "needsSetup" | "new" | "stalled";
  createdAfter?: Date;
  createdBefore?: Date;
};

export type AllianceHealth = {
  total: number;
  activeToday: number;
  newThisWeek: number;
};

export type AllianceReadinessStatus = "ready" | "needsSetup" | "new" | "stalled";

export type AllianceReadinessItem = {
  id: string;
  name: string;
  status: AllianceReadinessStatus;
  progress: number;
  lastActivity: Date | null;
  createdAt: Date;
  hasMetrics: boolean;
  hasPeriods: boolean;
  hasMembers: boolean;
  hasData: boolean;
};

export type AllianceReadinessSummary = {
  ready: number;
  needsSetup: number;
  new: number;
  stalled: number;
};

export type JumpLink = {
  label: string;
  href: string;
};

export type TimelineEvent = {
  event: string;
  timestamp: Date | null;
  completed: boolean;
};

export type AllianceTimeline = {
  allianceId: string;
  allianceName: string;
  events: TimelineEvent[];
};

/**
 * Get alliance health statistics.
 */
export async function getAllianceHealth(): Promise<AllianceHealth> {
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

/**
 * Get readiness status for all alliances.
 */
export async function getAllianceReadiness(): Promise<AllianceReadinessItem[]> {
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);

  const alliances = await prisma.alliance.findMany({
    select: {
      id: true,
      name: true,
      createdAt: true,
      updatedAt: true,
      _count: {
        select: {
          metrics: true,
          metricPeriods: true,
          allianceMembers: true,
        },
      },
      allianceMembers: {
        select: {
          createdAt: true,
          _count: { select: { metricEntries: true } },
          metricEntries: {
            select: { recordedAt: true },
            orderBy: { recordedAt: "desc" },
            take: 1,
          },
        },
        where: { archivedAt: null },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return alliances.map((alliance) => {
    const hasMetrics = alliance._count.metrics > 0;
    const hasPeriods = alliance._count.metricPeriods > 0;
    const hasMembers = alliance._count.allianceMembers > 0;
    const hasData = alliance.allianceMembers.some(
      (m) => m._count.metricEntries > 0
    );

    const completedSteps = [hasMetrics, hasPeriods, hasMembers, hasData].filter(
      Boolean
    ).length;
    const progress = Math.round((completedSteps / 4) * 100);

    const isComplete = hasMetrics && hasPeriods && hasMembers && hasData;
    const isNew = alliance.createdAt >= weekAgo;

    const lastMemberActivity = alliance.allianceMembers
      .flatMap((m) => m.metricEntries.map((e) => e.recordedAt))
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const lastMemberCreated = alliance.allianceMembers
      .map((m) => m.createdAt)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const lastActivity = lastMemberActivity || lastMemberCreated || null;

    const stalledThreshold = new Date();
    stalledThreshold.setDate(stalledThreshold.getDate() - 7);
    const isStalled =
      !isNew &&
      !isComplete &&
      (!lastActivity || lastActivity < stalledThreshold);

    let status: AllianceReadinessStatus;
    if (isNew) {
      status = "new";
    } else if (isStalled) {
      status = "stalled";
    } else if (isComplete) {
      status = "ready";
    } else {
      status = "needsSetup";
    }

    return {
      id: alliance.id,
      name: alliance.name,
      status,
      progress,
      lastActivity,
      createdAt: alliance.createdAt,
      hasMetrics,
      hasPeriods,
      hasMembers,
      hasData,
    };
  });
}

/**
 * Get readiness summary counts.
 */
export async function getAllianceReadinessSummary(): Promise<AllianceReadinessSummary> {
  const items = await getAllianceReadiness();
  return {
    ready: items.filter((a) => a.status === "ready").length,
    needsSetup: items.filter((a) => a.status === "needsSetup").length,
    new: items.filter((a) => a.status === "new").length,
    stalled: items.filter((a) => a.status === "stalled").length,
  };
}

/**
 * Get all alliances with optional filters.
 */
export async function getAllAlliances(
  filters?: AllianceFilters
): Promise<AllianceReadinessItem[]> {
  const items = await getAllianceReadiness();

  if (!filters) return items;

  return items.filter((alliance) => {
    if (filters.status && alliance.status !== filters.status) return false;
    if (filters.createdAfter && alliance.createdAt < filters.createdAfter)
      return false;
    if (filters.createdBefore && alliance.createdAt > filters.createdBefore)
      return false;
    return true;
  });
}

/**
 * Get timeline for a specific alliance.
 */
export async function getAllianceTimeline(
  allianceId: string
): Promise<AllianceTimeline | null> {
  const alliance = await prisma.alliance.findUnique({
    where: { id: allianceId },
    select: {
      id: true,
      name: true,
      createdAt: true,
      metrics: {
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      metricPeriods: {
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
      allianceMembers: {
        select: {
          createdAt: true,
          metricEntries: {
            select: { recordedAt: true },
            orderBy: { recordedAt: "asc" },
            take: 1,
          },
        },
        where: { archivedAt: null },
        orderBy: { createdAt: "asc" },
      },
      invitations: {
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  if (!alliance) return null;

  const firstMetricConfig = alliance.metrics[0]?.createdAt || null;
  const firstPeriod = alliance.metricPeriods[0]?.createdAt || null;
  const firstMember = alliance.allianceMembers[0]?.createdAt || null;
  const firstDataset = alliance.allianceMembers
    .flatMap((m) => m.metricEntries)
    .map((e) => e.recordedAt)
    .sort((a, b) => a.getTime() - b.getTime())[0] || null;
  const firstCollaboratorInvited = alliance.invitations[0]?.createdAt || null;

  const lastActivity = alliance.allianceMembers
    .flatMap((m) => m.metricEntries.map((e) => e.recordedAt))
    .sort((a, b) => b.getTime() - a.getTime())[0] || alliance.createdAt;

  const events: TimelineEvent[] = [
    { event: "Created", timestamp: alliance.createdAt, completed: true },
    {
      event: "Configured Metrics",
      timestamp: firstMetricConfig,
      completed: !!firstMetricConfig,
    },
    {
      event: "Created Period",
      timestamp: firstPeriod,
      completed: !!firstPeriod,
    },
    {
      event: "Imported Members",
      timestamp: firstMember,
      completed: !!firstMember,
    },
    {
      event: "Imported First Dataset",
      timestamp: firstDataset,
      completed: !!firstDataset,
    },
    {
      event: "Invited Collaborator",
      timestamp: firstCollaboratorInvited,
      completed: !!firstCollaboratorInvited,
    },
    { event: "Last Activity", timestamp: lastActivity, completed: true },
  ];

  return {
    allianceId: alliance.id,
    allianceName: alliance.name,
    events,
  };
}

/**
 * Get jump links for an alliance.
 */
export function getJumpLinks(allianceId: string): JumpLink[] {
  return [
    { label: "Open Dashboard", href: `/alliances/${allianceId}` },
    { label: "Open Setup", href: `/alliances/${allianceId}/setup` },
    { label: "Open Members", href: `/alliances/${allianceId}/members` },
    { label: "Open Import", href: `/alliances/${allianceId}/members/import` },
    { label: "Open Metrics", href: `/alliances/${allianceId}/metrics` },
    { label: "Open Periods", href: `/alliances/${allianceId}/periods` },
  ];
}

/**
 * Get a single alliance by ID for platform support.
 */
export async function getAllianceById(allianceId: string) {
  return prisma.alliance.findUnique({
    where: { id: allianceId },
    include: {
      _count: {
        select: {
          allianceMembers: true,
          metrics: true,
          metricPeriods: true,
          memberships: true,
          invitations: true,
        },
      },
      memberships: {
        include: {
          user: {
            select: { id: true, email: true, displayName: true },
          },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
}
