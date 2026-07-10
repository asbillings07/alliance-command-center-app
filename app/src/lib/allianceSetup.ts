import { prisma } from "./prisma";
import { type PermissionSet } from "./auth/permissions";

/**
 * Alliance setup represents the readiness of the alliance,
 * not the progress of an individual user.
 */

export type TypicalRole = "Owner" | "Admin" | "Leader";

export type SetupTaskId = "metrics" | "period" | "team" | "members" | "data";

export type SetupTaskDefinition = {
  id: SetupTaskId;
  label: string;
  typicallyCompletedBy: TypicalRole;
  href: (allianceId: string) => string;
  requiredPermission: keyof PermissionSet;
};

export type SetupTask = {
  id: SetupTaskId;
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

type SetupCounts = {
  metrics: number;
  periods: number;
  memberships: number;
  members: number;
  metricEntries: number;
};

/**
 * Fetch all setup-relevant counts in a single database round-trip.
 * This avoids N+1 queries when checking setup status.
 */
async function getSetupCounts(allianceId: string): Promise<SetupCounts> {
  const [metrics, periods, memberships, members, metricEntries] =
    await Promise.all([
      prisma.metric.count({ where: { allianceId } }),
      prisma.metricPeriod.count({ where: { allianceId } }),
      prisma.allianceMembership.count({ where: { allianceId } }),
      prisma.allianceMember.count({ where: { allianceId, archivedAt: null } }),
      prisma.memberMetricEntry.count({
        where: { allianceMember: { allianceId } },
      }),
    ]);

  return { metrics, periods, memberships, members, metricEntries };
}

function evaluateTaskCompletion(
  taskId: SetupTaskId,
  counts: SetupCounts
): boolean {
  switch (taskId) {
    case "metrics":
      return counts.metrics > 0;
    case "period":
      return counts.periods > 0;
    case "team":
      return counts.memberships > 1;
    case "members":
      return counts.members > 0;
    case "data":
      return counts.metricEntries > 0;
  }
}

/**
 * Declarative setup task definitions.
 * Ordered for R5 delegation: owner tasks first, then admin/leader tasks.
 *
 * Adding future tasks (Discord bot, billing, API keys) requires adding
 * to this array and updating evaluateTaskCompletion().
 *
 * Each task includes the required permission so the UI can filter
 * tasks the user cannot complete.
 */
export const SETUP_TASKS: SetupTaskDefinition[] = [
  {
    id: "metrics",
    label: "Configure Metrics",
    typicallyCompletedBy: "Owner",
    href: (id) => `/alliances/${id}/metrics`,
    requiredPermission: "canConfigureMetrics",
  },
  {
    id: "period",
    label: "Create Evaluation Period",
    typicallyCompletedBy: "Owner",
    href: (id) => `/alliances/${id}/periods`,
    requiredPermission: "canConfigurePeriods",
  },
  {
    id: "team",
    label: "Invite Leadership Team",
    typicallyCompletedBy: "Owner",
    href: (id) => `/alliances/${id}/settings/invitations`,
    requiredPermission: "canInviteCollaborators",
  },
  {
    id: "members",
    label: "Import Members",
    typicallyCompletedBy: "Admin",
    href: (id) => `/alliances/${id}/members/import`,
    requiredPermission: "canImportMembers",
  },
  {
    id: "data",
    label: "Import First Dataset",
    typicallyCompletedBy: "Leader",
    href: (id) => `/alliances/${id}/periods`,
    requiredPermission: "canImportMetrics",
  },
];

/**
 * Get the setup status for an alliance.
 *
 * This derives the current state from the database rather than
 * storing progress separately. Progress is alliance-level:
 * any authorized user completing a task updates progress for everyone.
 *
 * Efficiency: All counts are fetched in a single batch query via
 * getSetupCounts() to avoid N+1 database round-trips.
 *
 * If a PermissionSet is provided, tasks are filtered to only include
 * those the user has permission to complete. This ensures users only
 * see tasks they can actually act on.
 */
export async function getAllianceSetupStatus(
  allianceId: string,
  permissions?: PermissionSet
): Promise<AllianceSetupStatus> {
  const counts = await getSetupCounts(allianceId);

  // Filter to tasks the user can complete, if permissions provided
  const applicableTasks = permissions
    ? SETUP_TASKS.filter((t) => permissions[t.requiredPermission])
    : SETUP_TASKS;

  const tasks: SetupTask[] = applicableTasks.map((definition) => ({
    id: definition.id,
    label: definition.label,
    completed: evaluateTaskCompletion(definition.id, counts),
    href: definition.href(allianceId),
    typicallyCompletedBy: definition.typicallyCompletedBy,
  }));

  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;

  return {
    tasks,
    isComplete: completedCount === totalCount,
    completedCount,
    totalCount,
  };
}
