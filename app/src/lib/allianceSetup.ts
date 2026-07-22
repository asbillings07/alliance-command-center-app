import { prisma } from "./prisma";
import { type PermissionSet } from "./auth/permissions";
import { CREATE_PERIOD_TOUR_ID, IMPORT_MEMBERS_TOUR_ID } from "./tours";

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
  /**
   * The single task we recommend the user tackle next: the first applicable
   * (permission-filtered) incomplete task, required tasks first by definition
   * order. Null when the user has no remaining applicable tasks. Consumers
   * should use this rather than re-deriving "what's next" from `tasks`.
   */
  recommendedTask: SetupTask | null;
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
      // Only count pending invitations: not cancelled, not expired, not yet accepted
      prisma.invitation.count({
        where: {
          allianceId,
          cancelledAt: null,
          acceptedAt: null,
          expiresAt: { gt: new Date() },
        },
      }),
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
      // Complete when a pending invitation exists OR a collaborator has joined
      // Pending = not cancelled, not expired, not yet accepted
      // memberships > 1 covers accepted invitations (owner + at least one collaborator)
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
 * Setup tasks that have a guided tour on their destination page.
 *
 * Keyed by task id (not every task has one). The value is a tour id resolvable
 * via `TOURS_BY_ID`; `buildTourHref` turns it into a `?tour=...` deep link that
 * auto-starts the tour on the destination page (the user stays there when it
 * finishes). Keeping this map here (beside `SETUP_TASKS`) means adding a tour to
 * a task is a one-line, data-only change.
 */
export const SETUP_TASK_TOURS: Partial<Record<SetupTaskId, string>> = {
  period: CREATE_PERIOD_TOUR_ID,
  members: IMPORT_MEMBERS_TOUR_ID,
};

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
 * IMPORTANT: isComplete and requiredComplete/requiredTotal are always
 * computed against the FULL SETUP_TASKS list, not the filtered list.
 * This ensures that a Viewer seeing 0 applicable tasks doesn't incorrectly
 * see setup as "complete". The filtered `tasks` list is only for display.
 */
export async function getAllianceSetupStatus(
  allianceId: string,
  permissions?: PermissionSet
): Promise<AllianceSetupStatus> {
  const counts = await getSetupCounts(allianceId);

  // Compute actual alliance-wide completion status from ALL tasks
  // This is independent of what the current user can see/do
  const allRequiredTasks = SETUP_TASKS.filter((t) => t.required);
  const allRequiredComplete = allRequiredTasks.filter((t) =>
    evaluateTaskCompletion(t.id, counts)
  ).length;
  const allRequiredTotal = allRequiredTasks.length;

  // Filter to tasks the user can complete, if permissions provided
  // This is for display purposes only
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

  // First applicable incomplete task in definition order (required first).
  const recommendedTask = tasks.find((t) => !t.completed) ?? null;

  return {
    tasks,
    // Setup is complete when ALL required tasks (alliance-wide) are done
    isComplete: allRequiredComplete === allRequiredTotal,
    completedCount,
    totalCount,
    // These reflect alliance-wide required task status, not user-filtered
    requiredComplete: allRequiredComplete,
    requiredTotal: allRequiredTotal,
    recommendedTask,
  };
}
