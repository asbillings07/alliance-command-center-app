import { describe, it, expect } from "vitest";
import { AllianceRole } from "@/app/generated/prisma/enums";
import { buildDashboardWorkflowViewModel, type DashboardWorkflowViewModelInput } from "./dashboardWorkflowViewModel";

function input(overrides: Partial<DashboardWorkflowViewModelInput> = {}): DashboardWorkflowViewModelInput {
  return {
    role: AllianceRole.OWNER,
    permissions: {
      canInviteCollaborators: true,
      canImportMetrics: true,
      canImportMembers: true,
      canConfigurePeriods: true,
      canConfigureMetrics: true,
      canViewMembers: true,
    },
    hasArchivedPeriodsOnly: false,
    activePeriod: null,
    hasActiveMembers: false,
    hasPeriodMetrics: false,
    canProvision: false,
    reportsEnabled: false,
    rosterHealth: { activeCount: 0, archivedCount: 0, latestImport: null },
    rosterHealthDegraded: false,
    actionableFindingCount: null,
    findingsDegraded: false,
    ...overrides,
  };
}

describe("buildDashboardWorkflowViewModel", () => {
  describe("setup group", () => {
    it("shows the Leadership Team card exactly when canInviteCollaborators is true", () => {
      expect(
        buildDashboardWorkflowViewModel(input({ permissions: { ...input().permissions, canInviteCollaborators: true } }))
          .setup.showLeadershipTeamCard,
      ).toBe(true);
      expect(
        buildDashboardWorkflowViewModel(input({ permissions: { ...input().permissions, canInviteCollaborators: false } }))
          .setup.showLeadershipTeamCard,
      ).toBe(false);
    });

    it("passes the role through unchanged", () => {
      expect(buildDashboardWorkflowViewModel(input({ role: AllianceRole.VIEWER })).setup.role).toBe(
        AllianceRole.VIEWER,
      );
    });
  });

  describe("roster group", () => {
    it("passes health through and reports degraded state", () => {
      const health = { activeCount: 5, archivedCount: 2, latestImport: null };
      const vm = buildDashboardWorkflowViewModel(input({ rosterHealth: health, rosterHealthDegraded: false }));
      expect(vm.roster).toEqual({ health, degraded: false });
    });

    it("surfaces null health with degraded=true when the read model failed", () => {
      const vm = buildDashboardWorkflowViewModel(input({ rosterHealth: null, rosterHealthDegraded: true }));
      expect(vm.roster).toEqual({ health: null, degraded: true });
    });
  });

  describe("participation group card state", () => {
    it("is null when the user cannot import metrics", () => {
      const vm = buildDashboardWorkflowViewModel(
        input({ permissions: { ...input().permissions, canImportMetrics: false } }),
      );
      expect(vm.participation.cardState).toBeNull();
    });

    it("resolves 'no-period' when no active period exists, carrying archived-only and permission context", () => {
      const vm = buildDashboardWorkflowViewModel(
        input({ activePeriod: null, hasArchivedPeriodsOnly: true, permissions: { ...input().permissions, canConfigurePeriods: false } }),
      );
      expect(vm.participation.cardState).toEqual({
        kind: "no-period",
        hasArchivedPeriodsOnly: true,
        canConfigurePeriods: false,
      });
    });

    it("resolves 'no-active-members' when a period exists but no active members do", () => {
      const vm = buildDashboardWorkflowViewModel(
        input({
          activePeriod: { id: "period-1", name: "Week 1" },
          hasActiveMembers: false,
          permissions: { ...input().permissions, canImportMembers: false },
        }),
      );
      expect(vm.participation.cardState).toEqual({
        kind: "no-active-members",
        periodName: "Week 1",
        canImportMembers: false,
      });
    });

    it("resolves 'no-metrics-blocked' when no period metrics exist and provisioning is unavailable", () => {
      const vm = buildDashboardWorkflowViewModel(
        input({
          activePeriod: { id: "period-1", name: "Week 1" },
          hasActiveMembers: true,
          hasPeriodMetrics: false,
          canProvision: false,
          permissions: { ...input().permissions, canConfigurePeriods: true },
        }),
      );
      expect(vm.participation.cardState).toEqual({
        kind: "no-metrics-blocked",
        periodName: "Week 1",
        periodId: "period-1",
        canConfigurePeriods: true,
      });
    });

    it("resolves 'no-metrics-can-import' when no period metrics exist but provisioning is available", () => {
      const vm = buildDashboardWorkflowViewModel(
        input({
          activePeriod: { id: "period-1", name: "Week 1" },
          hasActiveMembers: true,
          hasPeriodMetrics: false,
          canProvision: true,
        }),
      );
      expect(vm.participation.cardState).toEqual({
        kind: "no-metrics-can-import",
        periodName: "Week 1",
        periodId: "period-1",
      });
    });

    it("resolves 'ready' when active members and period metrics both exist", () => {
      const vm = buildDashboardWorkflowViewModel(
        input({
          activePeriod: { id: "period-1", name: "Week 1" },
          hasActiveMembers: true,
          hasPeriodMetrics: true,
        }),
      );
      expect(vm.participation.cardState).toEqual({ kind: "ready", periodName: "Week 1", periodId: "period-1" });
    });
  });

  describe("participation group secondary cards", () => {
    it("shows Metrics Library exactly when canConfigureMetrics is true", () => {
      expect(
        buildDashboardWorkflowViewModel(input({ permissions: { ...input().permissions, canConfigureMetrics: true } }))
          .participation.showMetricsLibraryCard,
      ).toBe(true);
      expect(
        buildDashboardWorkflowViewModel(input({ permissions: { ...input().permissions, canConfigureMetrics: false } }))
          .participation.showMetricsLibraryCard,
      ).toBe(false);
    });

    it("shows Evaluation Periods exactly when canConfigurePeriods is true", () => {
      expect(
        buildDashboardWorkflowViewModel(input({ permissions: { ...input().permissions, canConfigurePeriods: true } }))
          .participation.showPeriodsCard,
      ).toBe(true);
      expect(
        buildDashboardWorkflowViewModel(input({ permissions: { ...input().permissions, canConfigurePeriods: false } }))
          .participation.showPeriodsCard,
      ).toBe(false);
    });

    it("shows Reports only when both canViewMembers and reportsEnabled are true", () => {
      expect(
        buildDashboardWorkflowViewModel(
          input({ permissions: { ...input().permissions, canViewMembers: true }, reportsEnabled: true }),
        ).participation.showReportsCard,
      ).toBe(true);
      expect(
        buildDashboardWorkflowViewModel(
          input({ permissions: { ...input().permissions, canViewMembers: true }, reportsEnabled: false }),
        ).participation.showReportsCard,
      ).toBe(false);
      expect(
        buildDashboardWorkflowViewModel(
          input({ permissions: { ...input().permissions, canViewMembers: false }, reportsEnabled: true }),
        ).participation.showReportsCard,
      ).toBe(false);
    });

    it("passes actionableFindingCount and degraded through unchanged", () => {
      expect(
        buildDashboardWorkflowViewModel(input({ actionableFindingCount: 3, findingsDegraded: false })).participation,
      ).toMatchObject({ actionableFindingCount: 3, degraded: false });
      expect(
        buildDashboardWorkflowViewModel(input({ actionableFindingCount: null, findingsDegraded: true })).participation,
      ).toMatchObject({ actionableFindingCount: null, degraded: true });
    });
  });
});
