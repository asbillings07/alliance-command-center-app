import type { AllianceRole } from "@/app/generated/prisma/enums";
import type { PermissionSet } from "@/app/src/lib/auth/permissions";
import type { RosterHealthSummary } from "@/app/src/lib/dashboard/getRosterHealthSummary";

/**
 * Pure view model for the grouped (#192) alliance dashboard - the boundary
 * between everything `page.tsx` loads (Prisma reads, setup status, feature
 * evaluation) and `WorkflowDashboard.tsx`'s rendering. Kept pure and
 * dependency-free (no Prisma, no `evaluateFeature`) so every branch state
 * is unit-testable without a database, mirroring
 * `membersPageContextualState.ts`'s resolver pattern.
 *
 * `LegacyDashboard.tsx` (the flag-disabled path) does not use this file at
 * all - it is a byte-for-byte extraction of the pre-#192 page, deliberately
 * kept independent so it can never be affected by changes here.
 */

export type ParticipationCardState =
  | { kind: "no-period"; hasArchivedPeriodsOnly: boolean; canConfigurePeriods: boolean }
  | { kind: "no-active-members"; periodName: string; canImportMembers: boolean }
  | {
      kind: "no-metrics-blocked";
      periodName: string;
      periodId: string;
      canConfigurePeriods: boolean;
    }
  | { kind: "no-metrics-can-import"; periodName: string; periodId: string }
  | { kind: "ready"; periodName: string; periodId: string };

export type WorkflowSetupGroupViewModel = {
  role: AllianceRole;
  showLeadershipTeamCard: boolean;
};

export type WorkflowRosterGroupViewModel = {
  /** Null exactly when getRosterHealthSummary failed - the group still renders, just without these stats (#332 §4 graceful degradation). */
  health: RosterHealthSummary | null;
  degraded: boolean;
};

export type WorkflowParticipationGroupViewModel = {
  /** Null when the acting user has no `canImportMetrics` permission - the Evaluation Results card is omitted entirely, matching today's dashboard. */
  cardState: ParticipationCardState | null;
  showMetricsLibraryCard: boolean;
  showPeriodsCard: boolean;
  showReportsCard: boolean;
  /**
   * Null when there's nothing to count yet (no active period, or the
   * period has no attached metrics - the setup/participation CTAs above
   * already cover that gap) or when the count could not be computed
   * (`degraded`).
   */
  actionableFindingCount: number | null;
  degraded: boolean;
};

export type DashboardWorkflowViewModel = {
  setup: WorkflowSetupGroupViewModel;
  roster: WorkflowRosterGroupViewModel;
  participation: WorkflowParticipationGroupViewModel;
};

export type DashboardWorkflowViewModelInput = {
  role: AllianceRole;
  permissions: Pick<
    PermissionSet,
    | "canInviteCollaborators"
    | "canImportMetrics"
    | "canImportMembers"
    | "canConfigurePeriods"
    | "canConfigureMetrics"
    | "canViewMembers"
  >;
  hasArchivedPeriodsOnly: boolean;
  activePeriod: { id: string; name: string } | null;
  hasActiveMembers: boolean;
  hasPeriodMetrics: boolean;
  canProvision: boolean;
  reportsEnabled: boolean;
  rosterHealth: RosterHealthSummary | null;
  rosterHealthDegraded: boolean;
  actionableFindingCount: number | null;
  findingsDegraded: boolean;
};

function resolveParticipationCardState(
  input: DashboardWorkflowViewModelInput,
): ParticipationCardState | null {
  const { permissions, activePeriod, hasArchivedPeriodsOnly, hasActiveMembers, hasPeriodMetrics, canProvision } =
    input;

  if (!permissions.canImportMetrics) {
    return null;
  }

  if (!activePeriod) {
    return {
      kind: "no-period",
      hasArchivedPeriodsOnly,
      canConfigurePeriods: permissions.canConfigurePeriods,
    };
  }

  if (!hasActiveMembers) {
    return {
      kind: "no-active-members",
      periodName: activePeriod.name,
      canImportMembers: permissions.canImportMembers,
    };
  }

  if (!hasPeriodMetrics && !canProvision) {
    return {
      kind: "no-metrics-blocked",
      periodName: activePeriod.name,
      periodId: activePeriod.id,
      canConfigurePeriods: permissions.canConfigurePeriods,
    };
  }

  if (!hasPeriodMetrics && canProvision) {
    return { kind: "no-metrics-can-import", periodName: activePeriod.name, periodId: activePeriod.id };
  }

  return { kind: "ready", periodName: activePeriod.name, periodId: activePeriod.id };
}

export function buildDashboardWorkflowViewModel(
  input: DashboardWorkflowViewModelInput,
): DashboardWorkflowViewModel {
  const { permissions, reportsEnabled, rosterHealth, rosterHealthDegraded, actionableFindingCount, findingsDegraded } =
    input;

  return {
    setup: {
      role: input.role,
      showLeadershipTeamCard: permissions.canInviteCollaborators,
    },
    roster: {
      health: rosterHealth,
      degraded: rosterHealthDegraded,
    },
    participation: {
      cardState: resolveParticipationCardState(input),
      showMetricsLibraryCard: permissions.canConfigureMetrics,
      showPeriodsCard: permissions.canConfigurePeriods,
      showReportsCard: permissions.canViewMembers && reportsEnabled,
      actionableFindingCount,
      degraded: findingsDegraded,
    },
  };
}
