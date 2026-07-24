import { prisma } from "../prisma";

/**
 * Activity Domain Service
 *
 * Provides queries for platform activity feed (Live Feed).
 * Operational, not historical - think GitHub notifications.
 */

export type ActivityType =
  | "alliance_created"
  | "metrics_configured"
  | "period_created"
  | "members_imported"
  | "data_imported"
  | "collaborator_invited"
  | "collaborator_accepted"
  | "beta_accepted";

export type ActivityItem = {
  id: string;
  type: ActivityType;
  allianceId: string | null;
  allianceName: string;
  description: string;
  timestamp: Date;
  href: string | null;
};

export type ActivityFilters = {
  allianceId?: string;
  type?: ActivityType;
  after?: Date;
  before?: Date;
  limit?: number;
};

/**
 * Get recent activity feed (Live Feed).
 */
export async function getRecentActivity(
  filters?: ActivityFilters
): Promise<ActivityItem[]> {
  const limit = filters?.limit || 20;
  const items: ActivityItem[] = [];

  // Recent alliance creations
  const allianceWhere: Record<string, unknown> = {};
  if (filters?.allianceId) allianceWhere.id = filters.allianceId;
  if (filters?.after) allianceWhere.createdAt = { gte: filters.after };
  if (filters?.before) {
    allianceWhere.createdAt = {
      ...((allianceWhere.createdAt as Record<string, unknown>) || {}),
      lte: filters.before,
    };
  }

  if (!filters?.type || filters.type === "alliance_created") {
    const recentAlliances = await prisma.alliance.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      where: allianceWhere,
      select: { id: true, name: true, createdAt: true },
    });

    for (const alliance of recentAlliances) {
      items.push({
        id: `alliance-${alliance.id}`,
        type: "alliance_created",
        allianceId: alliance.id,
        allianceName: alliance.name,
        description: "Alliance created",
        timestamp: alliance.createdAt,
        href: `/platform/support/alliance/${alliance.id}`,
      });
    }
  }

  // Recent metric configurations
  if (!filters?.type || filters.type === "metrics_configured") {
    const recentMetrics = await prisma.metric.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      where: filters?.allianceId ? { allianceId: filters.allianceId } : {},
      select: {
        id: true,
        createdAt: true,
        alliance: { select: { id: true, name: true } },
      },
    });

    const seenAlliances = new Set<string>();
    for (const metric of recentMetrics) {
      if (seenAlliances.has(metric.alliance.id)) continue;
      seenAlliances.add(metric.alliance.id);

      items.push({
        id: `metric-${metric.id}`,
        type: "metrics_configured",
        allianceId: metric.alliance.id,
        allianceName: metric.alliance.name,
        description: "Configured metrics",
        timestamp: metric.createdAt,
        href: `/platform/support/alliance/${metric.alliance.id}`,
      });
    }
  }

  // Recent period creations
  if (!filters?.type || filters.type === "period_created") {
    const recentPeriods = await prisma.metricPeriod.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      where: filters?.allianceId ? { allianceId: filters.allianceId } : {},
      select: {
        id: true,
        name: true,
        createdAt: true,
        alliance: { select: { id: true, name: true } },
      },
    });

    for (const period of recentPeriods) {
      items.push({
        id: `period-${period.id}`,
        type: "period_created",
        allianceId: period.alliance.id,
        allianceName: period.alliance.name,
        description: `Created period "${period.name}"`,
        timestamp: period.createdAt,
        href: `/platform/support/alliance/${period.alliance.id}`,
      });
    }
  }

  // Recent member imports (batch by alliance)
  if (!filters?.type || filters.type === "members_imported") {
    const recentMembers = await prisma.allianceMember.findMany({
      take: limit * 5,
      orderBy: { createdAt: "desc" },
      where: filters?.allianceId
        ? { allianceId: filters.allianceId }
        : { archivedAt: null },
      select: {
        id: true,
        createdAt: true,
        alliance: { select: { id: true, name: true } },
      },
    });

    const membersByAllianceAndHour = new Map<
      string,
      { alliance: { id: string; name: string }; count: number; timestamp: Date }
    >();

    for (const member of recentMembers) {
      const hourKey = `${member.alliance.id}-${member.createdAt.toISOString().slice(0, 13)}`;
      const existing = membersByAllianceAndHour.get(hourKey);
      if (existing) {
        existing.count++;
        if (member.createdAt > existing.timestamp) {
          existing.timestamp = member.createdAt;
        }
      } else {
        membersByAllianceAndHour.set(hourKey, {
          alliance: member.alliance,
          count: 1,
          timestamp: member.createdAt,
        });
      }
    }

    for (const [key, data] of membersByAllianceAndHour.entries()) {
      items.push({
        id: `members-${key}`,
        type: "members_imported",
        allianceId: data.alliance.id,
        allianceName: data.alliance.name,
        description: `Imported roster (${data.count} member${data.count === 1 ? "" : "s"})`,
        timestamp: data.timestamp,
        href: `/platform/support/alliance/${data.alliance.id}`,
      });
    }
  }

  // Recent metric entries (data imports)
  if (!filters?.type || filters.type === "data_imported") {
    const recentEntries = await prisma.memberMetricEntry.findMany({
      take: limit * 5,
      orderBy: { recordedAt: "desc" },
      where: filters?.allianceId
        ? { allianceMember: { allianceId: filters.allianceId } }
        : {},
      select: {
        id: true,
        recordedAt: true,
        allianceMember: {
          select: {
            alliance: { select: { id: true, name: true } },
          },
        },
      },
    });

    const entriesByAllianceAndHour = new Map<
      string,
      { alliance: { id: string; name: string }; count: number; timestamp: Date }
    >();

    for (const entry of recentEntries) {
      const hourKey = `${entry.allianceMember.alliance.id}-${entry.recordedAt.toISOString().slice(0, 13)}`;
      const existing = entriesByAllianceAndHour.get(hourKey);
      if (existing) {
        existing.count++;
        if (entry.recordedAt > existing.timestamp) {
          existing.timestamp = entry.recordedAt;
        }
      } else {
        entriesByAllianceAndHour.set(hourKey, {
          alliance: entry.allianceMember.alliance,
          count: 1,
          timestamp: entry.recordedAt,
        });
      }
    }

    for (const [key, data] of entriesByAllianceAndHour.entries()) {
      items.push({
        id: `data-${key}`,
        type: "data_imported",
        allianceId: data.alliance.id,
        allianceName: data.alliance.name,
        description: `Recorded ${data.count} evaluation result${data.count === 1 ? "" : "s"}`,
        timestamp: data.timestamp,
        href: `/platform/support/alliance/${data.alliance.id}`,
      });
    }
  }

  // Recent collaborator invitations
  if (!filters?.type || filters.type === "collaborator_invited") {
    const recentInvites = await prisma.invitation.findMany({
      take: limit,
      orderBy: { createdAt: "desc" },
      where: {
        ...(filters?.allianceId ? { allianceId: filters.allianceId } : {}),
        acceptedAt: null, // Only pending/expired invitations
      },
      include: {
        alliance: { select: { id: true, name: true } },
      },
    });

    for (const invite of recentInvites) {
      items.push({
        id: `invite-${invite.id}`,
        type: "collaborator_invited",
        allianceId: invite.alliance.id,
        allianceName: invite.alliance.name,
        description: `Invited ${invite.email} as ${invite.membershipRole}`,
        timestamp: invite.createdAt,
        href: `/platform/support/alliance/${invite.alliance.id}`,
      });
    }
  }

  // Recent collaborator acceptances
  if (!filters?.type || filters.type === "collaborator_accepted") {
    const acceptedInvites = await prisma.invitation.findMany({
      take: limit,
      orderBy: { acceptedAt: "desc" },
      where: {
        ...(filters?.allianceId ? { allianceId: filters.allianceId } : {}),
        acceptedAt: { not: null },
      },
      include: {
        alliance: { select: { id: true, name: true } },
      },
    });

    for (const invite of acceptedInvites) {
      if (!invite.acceptedAt) continue;
      items.push({
        id: `invite-accepted-${invite.id}`,
        type: "collaborator_accepted",
        allianceId: invite.alliance.id,
        allianceName: invite.alliance.name,
        description: `${invite.email} joined as ${invite.membershipRole}`,
        timestamp: invite.acceptedAt,
        href: `/platform/support/alliance/${invite.alliance.id}`,
      });
    }
  }

  // Recent beta acceptances
  if (!filters?.type || filters.type === "beta_accepted") {
    const recentBetaAccepts = await prisma.betaInvitation.findMany({
      take: limit,
      orderBy: { acceptedAt: "desc" },
      where: { acceptedAt: { not: null } },
      select: {
        id: true,
        email: true,
        acceptedAt: true,
      },
    });

    for (const beta of recentBetaAccepts) {
      if (!beta.acceptedAt) continue;
      items.push({
        id: `beta-${beta.id}`,
        type: "beta_accepted",
        allianceId: null,
        allianceName: beta.email,
        description: "Accepted beta invitation",
        timestamp: beta.acceptedAt,
        href: `/platform/beta`,
      });
    }
  }

  // Sort by timestamp descending
  items.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

  return items.slice(0, limit);
}

/**
 * Get activity for a specific alliance.
 */
export async function getAllianceActivity(
  allianceId: string,
  limit?: number
): Promise<ActivityItem[]> {
  return getRecentActivity({ allianceId, limit });
}
