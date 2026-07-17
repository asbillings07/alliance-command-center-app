import { prisma } from "./prisma";
import { type PermissionSet } from "./auth/permissions";

/**
 * Alliance setup represents the readiness of the alliance,
 * not the progress of an individual user.
 *
 * Setup tasks are divided into:
 * - Required: Must be completed before the owner can use the dashboard
 * - Optional: "Next steps" that enhance the alliance but don't block usage
 *
 * This separation ensures owners can get started quickly while still
 * seeing what's left to do.
 */

export type TypicalRole = "Owner" | "Admin" | "Leader";

export type SetupTaskId = "metrics" | "period" | "team" | "members" | "data";

export type SetupTaskDefinition = {
  id: SetupTaskId;
  label: string;
  description: string;
  typicallyCompletedBy: TypicalRole;
  href: (allianceId: string) => string;
  requiredPermission: keyof PermissionSet;
  /** If true, this task must be completed before setup is considered done */
  required: boolean;
};

export type SetupTask = {
  id: SetupTaskId;
  label: string;
  description: string;
  completed: boolean;
  href: string;
  typicallyCompletedBy: TypicalRole;
  required: boolean;
};

export type AllianceSetupStatus = {
  tasks: SetupTask[];
  /** True when all REQUIRED tasks are complete */
  isComplete: boolean;
  completedCount: number;
  totalCount: number;
  /** Separate counts for required vs optional tasks */
  requiredComplete: number;
  requiredTotal: number;
};

type SetupCounts = {
  metrics: number;
  periods: number;
  memberships: number;
  invitations: number;
  members: number;
  metricEntries: number;
};

/**
 * Fetch all setup-relevant counts in a single database round-trip.
 * This avoids N+1 queries when checking setup status.
 */
async function getSetupCounts(allianceId: string): Promise<SetupCounts> {
  const [metrics, periods, memberships, invitations, members, metricEntries] =
    await Promise.all([
      prisma.metric.count({ where: { allianceId } }),
      prisma.metricPeriod.count({ where: { allianceId } }),
      prisma.allianceMembership.count({ where: { allianceId } }),
      prisma.invitation.count({ where: { allianceId } }),
      prisma.allianceMember.count({ where: { allianceId, archivedAt: null } }),
      prisma.memberMetricEntry.count({
        where: { allianceMember: { allianceId } },
      }),
    ]);

  return { metrics, periods, memberships, invitations, members, metricEntries };
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
      // Changed: Complete when an invitation has been SENT, not when accepted
      // This prevents owners from being blocked waiting for collaborators
      return counts.invitations > 0 || counts.memberships > 1;
    case "members":
      return counts.members > 0;
    case "data":
      return counts.metricEntries > 0;
  }
}

/**
 * Declarative setup task definitions.
 *
 * Tasks are ordered: required owner tasks first, then optional next steps.
 *
 * Required tasks (metrics, period, team) must be completed before the
 * owner can access the dashboard. Optional tasks (members, data) are
 * "next steps" that don't block usage.
 *
 * Adding future tasks (Discord bot, billing, API keys) requires adding
 * to this array and updating evaluateTaskCompletion().
 */
export const SETUP_TASKS: SetupTaskDefinition[] = [
  // Required: Core setup that must be done before using the app
  {
    id: "metrics",
    label: "Configure Metrics",
    description: "Define what your alliance evaluates (e.g., VS Points, Donations)",
    typicallyCompletedBy: "Owner",
    href: (id) => `/alliances/${id}/metrics`,
    requiredPermission: "canConfigureMetrics",
    required: true,
  },
  {
    id: "period",
    label: "Create Evaluation Period",
    description: "Set up a time-boxed period to track member performance",
    typicallyCompletedBy: "Owner",
    href: (id) => `/alliances/${id}/periods`,
    requiredPermission: "canConfigurePeriods",
    required: true,
  },
  {
    id: "team",
    label: "Invite Leadership Team",
    description: "Send invitations to your admins and leaders (completes when sent)",
    typicallyCompletedBy: "Owner",
    href: (id) => `/alliances/${id}/settings/invitations`,
    requiredPermission: "canInviteCollaborators",
    required: true,
  },
  // Optional: Next steps that enhance the alliance
  {
    id: "members",
    label: "Import Members",
    description: "Upload your alliance roster from a spreadsheet",
    typicallyCompletedBy: "Admin",
    href: (id) => `/alliances/${id}/members/import`,
    requiredPermission: "canImportMembers",
    required: false,
  },
  {
    id: "data",
    label: "Import First Dataset",
    description: "Record or import metric data for your members",
    typicallyCompletedBy: "Leader",
    href: (id) => `/alliances/${id}/periods`,
    requiredPermission: "canImportMetrics",
    required: false,
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
 *
 * isComplete is true when all REQUIRED tasks are complete. Optional
 * tasks don't block the setup gate.
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
    description: definition.description,
    completed: evaluateTaskCompletion(definition.id, counts),
    href: definition.href(allianceId),
    typicallyCompletedBy: definition.typicallyCompletedBy,
    required: definition.required,
  }));

  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;

  // Only required tasks determine if setup is complete
  const requiredTasks = tasks.filter((t) => t.required);
  const requiredComplete = requiredTasks.filter((t) => t.completed).length;
  const requiredTotal = requiredTasks.length;

  return {
    tasks,
    isComplete: requiredComplete === requiredTotal,
    completedCount,
    totalCount,
    requiredComplete,
    requiredTotal,
  };
}
