import { prisma } from "../prisma";
import {
  listBetaParticipantsNeedingAttention,
  type BetaParticipantAttentionRow,
} from "./betaParticipants";

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
  /** True when the beta attention query failed; non-beta items are still present. */
  betaAttentionUnavailable: boolean;
};

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function participantIdentity(participant: BetaParticipantAttentionRow): string {
  return (
    participant.displayName ??
    participant.currentEmail ??
    participant.latestAttemptEmail
  );
}

function daysSinceAttention(now: Date, since: Date | null): number {
  if (!since) {
    return 0;
  }
  return Math.floor((now.getTime() - since.getTime()) / MS_PER_DAY);
}

function betaAttentionHref(participant: BetaParticipantAttentionRow): string {
  const reason = participant.attentionReason;
  if (
    reason === "setup_stalled" &&
    participant.allianceId &&
    !participant.allianceAmbiguous
  ) {
    return `/platform/support/alliance/${participant.allianceId}`;
  }
  return `/platform/beta?attentionReason=${reason}`;
}

/** Maps one authoritative beta participant attention row to an Action Required item. */
export function mapBetaParticipantToActionRequired(
  participant: BetaParticipantAttentionRow,
  now: Date,
): ActionRequiredItem {
  const identity = participantIdentity(participant);
  const days = daysSinceAttention(now, participant.attentionSince);
  const dayLabel = days === 1 ? "day" : "days";
  const reason = participant.attentionReason;
  const metadata = {
    participantId: participant.participantId,
    attentionReason: reason,
    attentionSince: participant.attentionSince?.toISOString() ?? null,
    allianceId: participant.allianceId,
  };

  switch (reason) {
    case "accepted_no_alliance":
      return {
        id: `beta-attention-${participant.participantId}`,
        severity: "critical",
        title: "Accepted beta, no alliance",
        description: `${identity} accepted ${days} ${dayLabel} ago`,
        href: betaAttentionHref(participant),
        metadata,
      };
    case "invitation_expired":
      return {
        id: `beta-attention-${participant.participantId}`,
        severity: "warning",
        title: "Expired beta invitation",
        description: `${identity} expired ${days}d ago`,
        href: betaAttentionHref(participant),
        metadata,
      };
    case "invitation_pending_stale":
      return {
        id: `beta-attention-${participant.participantId}`,
        severity: "warning",
        title: "Pending beta invitation",
        description: `${identity} pending ${days}d`,
        href: betaAttentionHref(participant),
        metadata,
      };
    case "setup_stalled":
      return {
        id: `beta-attention-${participant.participantId}`,
        severity: "warning",
        title: participant.allianceName
          ? `${participant.allianceName} setup stalled`
          : "Beta setup stalled",
        description: `${days}d since last setup activity`,
        href: betaAttentionHref(participant),
        allianceId: participant.allianceId ?? undefined,
        allianceName: participant.allianceName ?? undefined,
        metadata,
      };
  }
}

type BetaAttentionLoadResult = {
  items: ActionRequiredItem[];
  unavailable: boolean;
};

async function loadBetaActionRequiredItems(
  now: Date,
): Promise<BetaAttentionLoadResult> {
  try {
    const participants = await listBetaParticipantsNeedingAttention({ now });
    return {
      items: participants.map((participant) =>
        mapBetaParticipantToActionRequired(participant, now),
      ),
      unavailable: false,
    };
  } catch (error) {
    console.error("Beta attention query failed:", error);
    return { items: [], unavailable: true };
  }
}

async function getNonBetaActionRequiredItems(
  now: Date,
): Promise<ActionRequiredItem[]> {
  const items: ActionRequiredItem[] = [];
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 7);

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
      (now.getTime() - invite.createdAt.getTime()) / MS_PER_DAY,
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
 * Get all items requiring action, with severity.
 * Beta attention failures are isolated — non-beta items are still returned.
 */
export async function getActionRequired(
  now: Date = new Date(),
): Promise<ActionRequiredItem[]> {
  const [beta, nonBeta] = await Promise.all([
    loadBetaActionRequiredItems(now),
    getNonBetaActionRequiredItems(now),
  ]);

  return [...beta.items, ...nonBeta];
}

/**
 * Get action required items grouped by severity.
 */
export async function getActionRequiredBySeverity(
  now: Date = new Date(),
): Promise<GroupedActionRequired> {
  const [beta, nonBeta] = await Promise.all([
    loadBetaActionRequiredItems(now),
    getNonBetaActionRequiredItems(now),
  ]);

  const items = [...beta.items, ...nonBeta];

  return {
    critical: items.filter((i) => i.severity === "critical"),
    warning: items.filter((i) => i.severity === "warning"),
    info: items.filter((i) => i.severity === "info"),
    totalCount: items.length,
    betaAttentionUnavailable: beta.unavailable,
  };
}

/**
 * Get count of items by severity.
 */
export async function getActionRequiredCounts(
  now: Date = new Date(),
): Promise<{
  critical: number;
  warning: number;
  info: number;
  total: number;
}> {
  const grouped = await getActionRequiredBySeverity(now);
  return {
    critical: grouped.critical.length,
    warning: grouped.warning.length,
    info: grouped.info.length,
    total: grouped.totalCount,
  };
}
