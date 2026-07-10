import { prisma } from "./prisma";

/**
 * Alliance setup represents the readiness of the alliance,
 * not the progress of an individual user.
 */

export type TypicalRole = "Owner" | "Admin or Leader";

export type SetupTaskDefinition = {
  id: string;
  label: string;
  typicallyCompletedBy: TypicalRole;
  href: (allianceId: string) => string;
  detector: (allianceId: string) => Promise<boolean>;
};

export type SetupTask = {
  id: string;
  label: string;
  completed: boolean;
  href: string;
  typicallyCompletedBy: TypicalRole;
};

export type AllianceSetupStatus = {
  tasks: SetupTask[];
  isComplete: boolean;
  completedCount: number;
  totalCount: number;
};

async function hasMetrics(allianceId: string): Promise<boolean> {
  const count = await prisma.metric.count({
    where: { allianceId },
  });
  return count > 0;
}

async function hasPeriods(allianceId: string): Promise<boolean> {
  const count = await prisma.metricPeriod.count({
    where: { allianceId },
  });
  return count > 0;
}

async function hasMultipleMemberships(allianceId: string): Promise<boolean> {
  const count = await prisma.allianceMembership.count({
    where: { allianceId },
  });
  return count > 1;
}

async function hasMembers(allianceId: string): Promise<boolean> {
  const count = await prisma.allianceMember.count({
    where: { allianceId, archivedAt: null },
  });
  return count > 0;
}

async function hasMetricEntries(allianceId: string): Promise<boolean> {
  const count = await prisma.memberMetricEntry.count({
    where: {
      allianceMember: { allianceId },
    },
  });
  return count > 0;
}

/**
 * Declarative setup task definitions.
 * Ordered for R5 delegation: owner tasks first, then admin/leader tasks.
 *
 * Adding future tasks (Discord bot, billing, API keys) requires only
 * adding to this array—no service logic changes needed.
 */
export const SETUP_TASKS: SetupTaskDefinition[] = [
  {
    id: "metrics",
    label: "Configure Metrics",
    typicallyCompletedBy: "Owner",
    href: (id) => `/alliances/${id}/metrics`,
    detector: hasMetrics,
  },
  {
    id: "period",
    label: "Create Evaluation Period",
    typicallyCompletedBy: "Owner",
    href: (id) => `/alliances/${id}/periods`,
    detector: hasPeriods,
  },
  {
    id: "team",
    label: "Invite Leadership Team",
    typicallyCompletedBy: "Owner",
    href: (id) => `/alliances/${id}/settings/invitations`,
    detector: hasMultipleMemberships,
  },
  {
    id: "members",
    label: "Import Members",
    typicallyCompletedBy: "Admin or Leader",
    href: (id) => `/alliances/${id}/members/import`,
    detector: hasMembers,
  },
  {
    id: "data",
    label: "Import First Dataset",
    typicallyCompletedBy: "Admin or Leader",
    href: (id) => `/alliances/${id}/periods`,
    detector: hasMetricEntries,
  },
];

/**
 * Get the setup status for an alliance.
 *
 * This derives the current state from the database rather than
 * storing progress separately. Progress is alliance-level:
 * any authorized user completing a task updates progress for everyone.
 */
export async function getAllianceSetupStatus(
  allianceId: string
): Promise<AllianceSetupStatus> {
  const tasks: SetupTask[] = await Promise.all(
    SETUP_TASKS.map(async (definition) => ({
      id: definition.id,
      label: definition.label,
      completed: await definition.detector(allianceId),
      href: definition.href(allianceId),
      typicallyCompletedBy: definition.typicallyCompletedBy,
    }))
  );

  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;

  return {
    tasks,
    isComplete: completedCount === totalCount,
    completedCount,
    totalCount,
  };
}
