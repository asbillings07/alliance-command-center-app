import { prisma } from "../prisma";

/**
 * Attention Domain Service
 *
 * Provides queries for Action Required items with severity.
 * Answers "What should I do next?" not "What information can I display?"
 */

export type Severity = "critical" | "warning" | "info";

export type ActionRequiredItem = {
  id: string;
  severity: Severity;
  title: string;
  description: string;
  href: string;
  allianceId?: string;
  allianceName?: string;
  metadata?: Record<string, unknown>;
};

export type GroupedActionRequired = {
  critical: ActionRequiredItem[];
  warning: ActionRequiredItem[];
  info: ActionRequiredItem[];
  totalCount: number;
};

/**
 * Get all items requiring action, with severity.
 */
export async function getActionRequired(): Promise<ActionRequiredItem[]> {
  const items: ActionRequiredItem[] = [];
  const now = new Date();
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

  // CRITICAL: Accepted beta invitation but never created alliance
  const acceptedBetaInvites = await prisma.betaInvitation.findMany({
    where: { acceptedAt: { not: null } },
    select: { id: true, email: true, acceptedAt: true },
  });

  const usersWithAlliances = await prisma.user.findMany({
    where: {
      email: { in: acceptedBetaInvites.map((i) => i.email) },
      memberships: { some: { role: "OWNER" } },
    },
    select: { email: true },
  });

  const usersWithAlliancesSet = new Set(usersWithAlliances.map((u) => u.email));
  const stuckBetaUsers = acceptedBetaInvites.filter(
    (i) => !usersWithAlliancesSet.has(i.email)
  );

  for (const user of stuckBetaUsers) {
    const daysSinceAccepted = user.acceptedAt
      ? Math.floor(
          (now.getTime() - user.acceptedAt.getTime()) / (1000 * 60 * 60 * 24)
        )
      : 0;

    items.push({
      id: `beta-no-alliance-${user.id}`,
      severity: "critical",
      title: "Accepted beta but no alliance",
      description: `${user.email} accepted ${daysSinceAccepted} day${daysSinceAccepted === 1 ? "" : "s"} ago`,
      href: `/platform/beta`,
      metadata: { email: user.email, daysSinceAccepted },
    });
  }

  // WARNING: Alliances stalled during setup (7+ days, incomplete)
  const stalledAlliances = await prisma.alliance.findMany({
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
      _count: {
        select: { metrics: true, metricPeriods: true, allianceMembers: true },
      },
    },
    take: 10,
    orderBy: { createdAt: "asc" },
  });

  for (const alliance of stalledAlliances) {
    const daysSinceCreated = Math.floor(
      (now.getTime() - alliance.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    const missing: string[] = [];
    if (alliance._count.metrics === 0) missing.push("metrics");
    if (alliance._count.metricPeriods === 0) missing.push("periods");
    if (alliance._count.allianceMembers === 0) missing.push("members");

    items.push({
      id: `stalled-${alliance.id}`,
      severity: "warning",
      title: `${alliance.name} setup stalled`,
      description: `${daysSinceCreated}d old, missing: ${missing.join(", ") || "data"}`,
      href: `/platform/support/alliance/${alliance.id}`,
      allianceId: alliance.id,
      allianceName: alliance.name,
      metadata: { daysSinceCreated, missing },
    });
  }

  // WARNING: Expired beta invitations
  const expiredBetaInvites = await prisma.betaInvitation.findMany({
    where: {
      acceptedAt: null,
      expiresAt: { lt: now },
    },
    select: { id: true, email: true, expiresAt: true },
    take: 10,
    orderBy: { expiresAt: "desc" },
  });

  for (const invite of expiredBetaInvites) {
    const daysSinceExpired = Math.floor(
      (now.getTime() - invite.expiresAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    items.push({
      id: `expired-beta-${invite.id}`,
      severity: "warning",
      title: "Expired beta invitation",
      description: `${invite.email} expired ${daysSinceExpired}d ago`,
      href: `/platform/beta`,
      metadata: { email: invite.email, daysSinceExpired },
    });
  }

  // WARNING: Pending collaborator invitations older than 7 days
  const oldCollabInvites = await prisma.invitation.findMany({
    where: {
      acceptedAt: null,
      expiresAt: { gte: now },
      createdAt: { lt: weekAgo },
    },
    include: {
      alliance: { select: { id: true, name: true } },
    },
    take: 10,
    orderBy: { createdAt: "asc" },
  });

  for (const invite of oldCollabInvites) {
    const daysPending = Math.floor(
      (now.getTime() - invite.createdAt.getTime()) / (1000 * 60 * 60 * 24)
    );

    items.push({
      id: `old-collab-${invite.id}`,
      severity: "warning",
      title: "Pending collaborator invitation",
      description: `${invite.email} (${invite.alliance.name}) ${daysPending}d`,
      href: `/platform/support/alliance/${invite.alliance.id}`,
      allianceId: invite.alliance.id,
      allianceName: invite.alliance.name,
      metadata: { email: invite.email, daysPending },
    });
  }

  // INFO: Invitations expiring soon (within 3 days)
  const threeDaysFromNow = new Date(now);
  threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);

  const expiringBetaInvites = await prisma.betaInvitation.findMany({
    where: {
      acceptedAt: null,
      expiresAt: { gte: now, lte: threeDaysFromNow },
    },
    select: { id: true, email: true, expiresAt: true },
    take: 5,
  });

  for (const invite of expiringBetaInvites) {
    const daysUntilExpiry = Math.ceil(
      (invite.expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
    );

    items.push({
      id: `expiring-beta-${invite.id}`,
      severity: "info",
      title: "Beta invitation expiring soon",
      description: `${invite.email} expires in ${daysUntilExpiry}d`,
      href: `/platform/beta`,
      metadata: { email: invite.email, daysUntilExpiry },
    });
  }

  // INFO: Alliances with no metrics configured (but created recently)
  const alliancesNoMetrics = await prisma.alliance.findMany({
    where: {
      createdAt: { gte: weekAgo },
      metrics: { none: {} },
    },
    select: { id: true, name: true, createdAt: true },
    take: 5,
    orderBy: { createdAt: "desc" },
  });

  for (const alliance of alliancesNoMetrics) {
    items.push({
      id: `no-metrics-${alliance.id}`,
      severity: "info",
      title: "No metrics configured",
      description: alliance.name,
      href: `/platform/support/alliance/${alliance.id}`,
      allianceId: alliance.id,
      allianceName: alliance.name,
    });
  }

  return items;
}

/**
 * Get action required items grouped by severity.
 */
export async function getActionRequiredBySeverity(): Promise<GroupedActionRequired> {
  const items = await getActionRequired();

  return {
    critical: items.filter((i) => i.severity === "critical"),
    warning: items.filter((i) => i.severity === "warning"),
    info: items.filter((i) => i.severity === "info"),
    totalCount: items.length,
  };
}

/**
 * Get count of items by severity.
 */
export async function getActionRequiredCounts(): Promise<{
  critical: number;
  warning: number;
  info: number;
  total: number;
}> {
  const grouped = await getActionRequiredBySeverity();
  return {
    critical: grouped.critical.length,
    warning: grouped.warning.length,
    info: grouped.info.length,
    total: grouped.totalCount,
  };
}
