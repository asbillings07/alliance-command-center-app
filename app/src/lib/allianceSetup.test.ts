import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAllianceSetupStatus,
  SETUP_TASKS,
  SETUP_TASK_TOURS,
} from "./allianceSetup";
import { TOURS_BY_ID } from "./tours";

vi.mock("./prisma", () => ({
  prisma: {
    metric: {
      count: vi.fn(),
    },
    metricPeriod: {
      count: vi.fn(),
    },
    allianceMembership: {
      count: vi.fn(),
    },
    invitation: {
      count: vi.fn(),
    },
    allianceMember: {
      count: vi.fn(),
    },
    memberMetricEntry: {
      count: vi.fn(),
    },
  },
}));

import { prisma } from "./prisma";

const mockPrisma = prisma as unknown as {
  metric: { count: ReturnType<typeof vi.fn> };
  metricPeriod: { count: ReturnType<typeof vi.fn> };
  allianceMembership: { count: ReturnType<typeof vi.fn> };
  invitation: { count: ReturnType<typeof vi.fn> };
  allianceMember: { count: ReturnType<typeof vi.fn> };
  memberMetricEntry: { count: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("SETUP_TASKS", () => {
  it("has 5 tasks in the correct order", () => {
    expect(SETUP_TASKS).toHaveLength(5);
    expect(SETUP_TASKS.map((t) => t.id)).toEqual([
      "metrics",
      "period",
      "team",
      "members",
      "data",
    ]);
  });

  it("has founding operator tasks before admin/leader tasks", () => {
    const foundingOperatorTasks = SETUP_TASKS.filter(
      (t) => t.typicallyCompletedBy === "Founding Operator"
    );
    const nonFoundingOperatorTasks = SETUP_TASKS.filter(
      (t) => t.typicallyCompletedBy !== "Founding Operator"
    );

    expect(foundingOperatorTasks).toHaveLength(3);
    expect(nonFoundingOperatorTasks).toHaveLength(2);

    const lastFoundingOperatorIndex = SETUP_TASKS.findLastIndex(
      (t) => t.typicallyCompletedBy === "Founding Operator"
    );
    const firstNonFoundingOperatorIndex = SETUP_TASKS.findIndex(
      (t) => t.typicallyCompletedBy !== "Founding Operator"
    );

    expect(lastFoundingOperatorIndex).toBeLessThan(firstNonFoundingOperatorIndex);
  });

  it("has required permissions for each task", () => {
    expect(SETUP_TASKS[0].requiredPermission).toBe("canConfigureMetrics");
    expect(SETUP_TASKS[1].requiredPermission).toBe("canConfigurePeriods");
    expect(SETUP_TASKS[2].requiredPermission).toBe("canInviteCollaborators");
    expect(SETUP_TASKS[3].requiredPermission).toBe("canImportMembers");
    expect(SETUP_TASKS[4].requiredPermission).toBe("canImportMetrics");
  });

  it("generates correct hrefs", () => {
    const allianceId = "test-alliance-id";
    
    expect(SETUP_TASKS[0].href(allianceId)).toBe(`/alliances/${allianceId}/metrics`);
    expect(SETUP_TASKS[1].href(allianceId)).toBe(`/alliances/${allianceId}/periods`);
    expect(SETUP_TASKS[2].href(allianceId)).toBe(`/alliances/${allianceId}/settings/invitations`);
    expect(SETUP_TASKS[3].href(allianceId)).toBe(`/alliances/${allianceId}/members/import`);
    expect(SETUP_TASKS[4].href(allianceId)).toBe(`/alliances/${allianceId}/periods`);
  });
});

describe("SETUP_TASK_TOURS", () => {
  it("only keys real setup tasks", () => {
    const taskIds = new Set(SETUP_TASKS.map((t) => t.id));
    for (const taskId of Object.keys(SETUP_TASK_TOURS)) {
      expect(taskIds.has(taskId as (typeof SETUP_TASKS)[number]["id"])).toBe(
        true
      );
    }
  });

  it("maps every task to a tour that exists in the registry", () => {
    for (const tourId of Object.values(SETUP_TASK_TOURS)) {
      expect(tourId).toBeDefined();
      expect(TOURS_BY_ID.has(tourId as string)).toBe(true);
    }
  });
});

describe("getAllianceSetupStatus", () => {
  it("returns all tasks incomplete for new alliance", async () => {
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.isComplete).toBe(false);
    expect(status.completedCount).toBe(0);
    expect(status.totalCount).toBe(5);
    expect(status.tasks.every((t) => !t.completed)).toBe(true);
  });

  it("returns all tasks complete for fully setup alliance", async () => {
    mockPrisma.metric.count.mockResolvedValue(3);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(4);
    mockPrisma.invitation.count.mockResolvedValue(2);
    mockPrisma.allianceMember.count.mockResolvedValue(50);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(150);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.isComplete).toBe(true);
    expect(status.completedCount).toBe(5);
    expect(status.totalCount).toBe(5);
    expect(status.tasks.every((t) => t.completed)).toBe(true);
  });

  it("returns partial completion correctly", async () => {
    mockPrisma.metric.count.mockResolvedValue(2);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.isComplete).toBe(false);
    expect(status.completedCount).toBe(2);
    expect(status.totalCount).toBe(5);

    const metricsTask = status.tasks.find((t) => t.id === "metrics");
    const periodTask = status.tasks.find((t) => t.id === "period");
    const teamTask = status.tasks.find((t) => t.id === "team");

    expect(metricsTask?.completed).toBe(true);
    expect(periodTask?.completed).toBe(true);
    expect(teamTask?.completed).toBe(false);
  });

  it("team task completes when pending invitation exists or membership > 1", async () => {
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");
    const teamTask = status.tasks.find((t) => t.id === "team");

    expect(teamTask?.completed).toBe(false);

    // Team task completes when a pending invitation exists
    // (Note: the actual Prisma query filters for non-cancelled, non-expired, non-accepted)
    mockPrisma.invitation.count.mockResolvedValue(1);
    const status2 = await getAllianceSetupStatus("alliance-1");
    const teamTask2 = status2.tasks.find((t) => t.id === "team");

    expect(teamTask2?.completed).toBe(true);

    // Or when membership > 1 (collaborator has joined)
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(2);
    const status3 = await getAllianceSetupStatus("alliance-1");
    const teamTask3 = status3.tasks.find((t) => t.id === "team");

    expect(teamTask3?.completed).toBe(true);
  });

  it("includes correct task metadata", async () => {
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");

    const metricsTask = status.tasks.find((t) => t.id === "metrics");
    expect(metricsTask).toEqual({
      id: "metrics",
      label: "Configure Metrics",
      description: "Define what your alliance evaluates (e.g., VS Points, Donations)",
      completed: true,
      href: "/alliances/alliance-1/metrics",
      typicallyCompletedBy: "Founding Operator",
      required: true,
    });
  });

  it("filters tasks by permissions when provided", async () => {
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    // Leader permissions: can only import metrics and manage notes
    const leaderPermissions = {
      canViewAlliance: true,
      canViewMembers: true,
      canViewNotes: true,
      canManageNotes: true,
      canImportMetrics: true,
      canManageMembers: false,
      canImportMembers: false,
      canConfigureMetrics: false,
      canConfigurePeriods: false,
      canInviteCollaborators: false,
      canManageLeadership: false,
      canManageAlliance: false,
    };

    const status = await getAllianceSetupStatus("alliance-1", leaderPermissions);

    // Leader should only see the "data" task (Import First Dataset)
    expect(status.tasks).toHaveLength(1);
    expect(status.tasks[0].id).toBe("data");
    expect(status.totalCount).toBe(1);
    
    // But isComplete reflects the alliance-wide status (all required tasks incomplete)
    expect(status.isComplete).toBe(false);
    expect(status.requiredTotal).toBe(3); // metrics, period, team are required
    expect(status.requiredComplete).toBe(0);
  });

  it("returns all tasks when no permissions provided", async () => {
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.tasks).toHaveLength(5);
    expect(status.totalCount).toBe(5);
  });

  it("recommends the first incomplete task in order for a new alliance", async () => {
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.recommendedTask?.id).toBe("metrics");
  });

  it("advances the recommendation as earlier tasks complete", async () => {
    // metrics + period done -> next recommended is team
    mockPrisma.metric.count.mockResolvedValue(2);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.recommendedTask?.id).toBe("team");
  });

  it("returns null recommendation when all applicable tasks are complete", async () => {
    mockPrisma.metric.count.mockResolvedValue(3);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(4);
    mockPrisma.invitation.count.mockResolvedValue(2);
    mockPrisma.allianceMember.count.mockResolvedValue(50);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(150);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.recommendedTask).toBeNull();
  });

  it("recommends only tasks the user can act on (permission-filtered)", async () => {
    // Required tasks incomplete, but a leader can only act on the data task.
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const leaderPermissions = {
      canViewAlliance: true,
      canViewMembers: true,
      canViewNotes: true,
      canManageNotes: true,
      canImportMetrics: true,
      canManageMembers: false,
      canImportMembers: false,
      canConfigureMetrics: false,
      canConfigurePeriods: false,
      canInviteCollaborators: false,
      canManageLeadership: false,
      canManageAlliance: false,
    };

    const status = await getAllianceSetupStatus("alliance-1", leaderPermissions);

    expect(status.recommendedTask?.id).toBe("data");
  });

  it("returns null recommendation when the user has no applicable tasks", async () => {
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const viewerPermissions = {
      canViewAlliance: true,
      canViewMembers: true,
      canViewNotes: true,
      canManageNotes: false,
      canImportMetrics: false,
      canManageMembers: false,
      canImportMembers: false,
      canConfigureMetrics: false,
      canConfigurePeriods: false,
      canInviteCollaborators: false,
      canManageLeadership: false,
      canManageAlliance: false,
    };

    const status = await getAllianceSetupStatus("alliance-1", viewerPermissions);

    expect(status.recommendedTask).toBeNull();
  });

  it("isComplete reflects alliance-wide status even when tasks are filtered", async () => {
    // All required tasks complete: metrics, period, team
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(2);
    mockPrisma.invitation.count.mockResolvedValue(1);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    // Viewer permissions: can't see any setup tasks
    const viewerPermissions = {
      canViewAlliance: true,
      canViewMembers: true,
      canViewNotes: true,
      canManageNotes: false,
      canImportMetrics: false,
      canManageMembers: false,
      canImportMembers: false,
      canConfigureMetrics: false,
      canConfigurePeriods: false,
      canInviteCollaborators: false,
      canManageLeadership: false,
      canManageAlliance: false,
    };

    const status = await getAllianceSetupStatus("alliance-1", viewerPermissions);

    // Viewer sees no tasks
    expect(status.tasks).toHaveLength(0);
    expect(status.totalCount).toBe(0);
    
    // But isComplete correctly reflects alliance-wide status
    // Required tasks (metrics, period, team) are all complete
    expect(status.isComplete).toBe(true);
    expect(status.requiredTotal).toBe(3);
    expect(status.requiredComplete).toBe(3);
  });
});
