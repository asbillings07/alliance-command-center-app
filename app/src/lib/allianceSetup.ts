import { prisma } from "./prisma";
import { type PermissionSet } from "./auth/permissions";
import { CREATE_PERIOD_TOUR_ID, IMPORT_MEMBERS_TOUR_ID } from "./tours";
import {
  resolveTargetPeriod,
  type TargetPeriod,
} from "./periods/resolveTargetPeriod";

/**
 * Alliance setup represents the readiness of the alliance,
 * not the progress of an individual user.
 *
 * Setup tasks are divided into:
 * - Required: Period, Metrics, Members, and Data must be complete before setup
 *   is considered done
 * - Optional: Team invitation is a "next step" that does not block usage
 */

/**
 * Typical persona completing each setup task.
 *
 * "Founding Operator" is an onboarding persona label (not an ACC role).
 * "Admin" and "Leader" refer to ACC authorization roles.
 * The actual authorization is based on the required permission.
 */
export type TypicalRole = "Founding Operator" | "Admin" | "Leader";

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
  actionable: boolean;
  /** Explanatory note shown regardless of actionable state. */
  hint?: string;
  blockedReason?: string;
  /** Direct link to unblock this task, only when the caller can perform it. */
  blockedFix?: { label: string; href: string };
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
   * Latest active evaluation period, or null when none exist (including
   * archived-only). Consumers can use this with hasArchivedPeriodsOnly to
   * offer restore/select/create guidance.
   */
  targetPeriodId: string | null;
  /** True when periods exist but none are active. */
  hasArchivedPeriodsOnly: boolean;
  /**
   * The single task we recommend the user tackle next: the first applicable
   * (permission-filtered) incomplete task in definition order. Null when the
   * user has no remaining applicable tasks. Consumers should use this rather
   * than re-deriving "what's next" from `tasks`.
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

const DATA_BLOCKED_BY_MEMBERS_REASON =
  "An Admin or Owner must import members before you can import evaluation results.";

const ARCHIVED_PERIODS_ONLY_HINT =
  "Only inactive evaluation periods exist. Restore one or create a new period to continue.";

function getMembersImportHref(allianceId: string): string {
  return `/alliances/${allianceId}/members/import`;
}

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

function buildCompletionByTask(
  counts: SetupCounts,
  targetPeriod: TargetPeriod | null,
  targetPeriodHasEntries: boolean,
): Record<SetupTaskId, boolean> {
  return {
    period: targetPeriod !== null,
    metrics: (targetPeriod?.periodMetrics.length ?? 0) > 0,
    members: counts.members > 0,
    data: targetPeriodHasEntries,
    team: counts.invitations > 0 || counts.memberships > 1,
  };
}

function getTaskActionability(
  taskId: SetupTaskId,
  counts: SetupCounts,
  allianceId: string,
  permissions?: PermissionSet,
): Pick<SetupTask, "actionable" | "blockedReason" | "blockedFix"> {
  if (taskId === "data" && counts.members === 0) {
    const result: Pick<SetupTask, "actionable" | "blockedReason" | "blockedFix"> = {
      actionable: false,
      blockedReason: DATA_BLOCKED_BY_MEMBERS_REASON,
    };
    if (permissions?.canImportMembers) {
      result.blockedFix = {
        label: "Import Members",
        href: getMembersImportHref(allianceId),
      };
    }
    return result;
  }
  return { actionable: true };
}

/**
 * Declarative setup task definitions.
 *
 * Tasks are ordered: required setup first (period through data), then optional
 * team invitation last.
 */
export const SETUP_TASKS: SetupTaskDefinition[] = [
  {
    id: "period",
    label: "Create Evaluation Period",
    description: "Set up a time-boxed period to track member performance",
    typicallyCompletedBy: "Founding Operator",
    href: (id) => `/alliances/${id}/periods`,
    requiredPermission: "canConfigurePeriods",
    required: true,
  },
  {
    id: "metrics",
    label: "Configure Metrics",
    description: "Define what your alliance evaluates (e.g., VS Points, Donations)",
    typicallyCompletedBy: "Founding Operator",
    href: (id) => `/alliances/${id}/metrics`,
    requiredPermission: "canConfigureMetrics",
    required: true,
  },
  {
    id: "members",
    label: "Import Members",
    description: "Upload a spreadsheet to add or restore members",
    typicallyCompletedBy: "Admin",
    href: (id) => `/alliances/${id}/members/import`,
    requiredPermission: "canImportMembers",
    required: true,
  },
  {
    id: "data",
    label: "Import Evaluation Results",
    description: "Add member values for metrics in a specific evaluation period",
    typicallyCompletedBy: "Leader",
    href: (id) => `/alliances/${id}/periods`,
    requiredPermission: "canImportMetrics",
    required: true,
  },
  {
    id: "team",
    label: "Invite Leadership Team",
    description: "Send invitations to your admins and leaders (completes when sent)",
    typicallyCompletedBy: "Founding Operator",
    href: (id) => `/alliances/${id}/settings/invitations`,
    requiredPermission: "canInviteCollaborators",
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
  permissions?: PermissionSet,
): Promise<AllianceSetupStatus> {
  const counts = await getSetupCounts(allianceId);
  const targetPeriod = await resolveTargetPeriod(allianceId);
  const hasArchivedPeriodsOnly = targetPeriod === null && counts.periods > 0;

  let targetPeriodHasEntries = false;
  if (targetPeriod) {
    const activeMetricIds = targetPeriod.periodMetrics.map((pm) => pm.metricId);
    if (activeMetricIds.length > 0) {
      const targetEntriesCount = await prisma.memberMetricEntry.count({
        where: {
          periodId: targetPeriod.id,
          metricId: { in: activeMetricIds },
          allianceMember: { allianceId },
        },
      });
      targetPeriodHasEntries = targetEntriesCount > 0;
    }
  }

  const completionByTask = buildCompletionByTask(
    counts,
    targetPeriod,
    targetPeriodHasEntries,
  );

  const allRequiredTasks = SETUP_TASKS.filter((t) => t.required);
  const allRequiredComplete = allRequiredTasks.filter(
    (t) => completionByTask[t.id],
  ).length;
  const allRequiredTotal = allRequiredTasks.length;

  const applicableTasks = permissions
    ? SETUP_TASKS.filter((t) => permissions[t.requiredPermission])
    : SETUP_TASKS;

  const tasks: SetupTask[] = applicableTasks.map((definition) => {
    let href = definition.href(allianceId);
    const completed = completionByTask[definition.id];
    const { actionable, blockedReason, blockedFix } = getTaskActionability(
      definition.id,
      counts,
      allianceId,
      permissions,
    );

    if (definition.id === "metrics") {
      if (targetPeriod) {
        href = `/alliances/${allianceId}/periods/${targetPeriod.id}`;
      } else {
        href = `/alliances/${allianceId}/periods`;
      }
    }

    if (definition.id === "data" && targetPeriod) {
      const hasAssignedMetrics = targetPeriod.periodMetrics.length > 0;
      const canProvisionMetrics = Boolean(
        permissions?.canConfigureMetrics || permissions?.canConfigurePeriods,
      );
      if (hasAssignedMetrics || canProvisionMetrics) {
        href = `/alliances/${allianceId}/periods/${targetPeriod.id}/import`;
      } else {
        href = `/alliances/${allianceId}/periods/${targetPeriod.id}`;
      }
    }

    const hint =
      definition.id === "period" && hasArchivedPeriodsOnly
        ? ARCHIVED_PERIODS_ONLY_HINT
        : undefined;

    return {
      id: definition.id,
      label: definition.label,
      description: definition.description,
      completed,
      href,
      typicallyCompletedBy: definition.typicallyCompletedBy,
      required: definition.required,
      actionable,
      hint,
      blockedReason,
      blockedFix,
    };
  });

  const completedCount = tasks.filter((t) => t.completed).length;
  const totalCount = tasks.length;
  const recommendedTask =
    tasks.find((t) => !t.completed && t.actionable) ?? null;

  return {
    tasks,
    isComplete: allRequiredComplete === allRequiredTotal,
    completedCount,
    totalCount,
    requiredComplete: allRequiredComplete,
    requiredTotal: allRequiredTotal,
    targetPeriodId: targetPeriod?.id ?? null,
    hasArchivedPeriodsOnly,
    recommendedTask,
  };
}
