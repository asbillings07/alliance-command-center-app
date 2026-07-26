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
      findFirst: vi.fn(),
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
import { metricPeriodChronologicalOrderBy } from "./metricPeriodOrdering";

const mockPrisma = prisma as unknown as {
  metric: { count: ReturnType<typeof vi.fn> };
  metricPeriod: {
    count: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  allianceMembership: { count: ReturnType<typeof vi.fn> };
  invitation: { count: ReturnType<typeof vi.fn> };
  allianceMember: { count: ReturnType<typeof vi.fn> };
  memberMetricEntry: { count: ReturnType<typeof vi.fn> };
};

const defaultTargetPeriod = {
  id: "period-123",
  name: "Season 7",
  periodMetrics: [{ metricId: "m-1" }],
};

function mockFullyCompleteCounts() {
  mockPrisma.metric.count.mockResolvedValue(3);
  mockPrisma.metricPeriod.count.mockResolvedValue(1);
  mockPrisma.allianceMembership.count.mockResolvedValue(4);
  mockPrisma.invitation.count.mockResolvedValue(2);
  mockPrisma.allianceMember.count.mockResolvedValue(50);
  mockPrisma.memberMetricEntry.count.mockImplementation(async (args?: { where?: { periodId?: string } }) => {
    if (args?.where?.periodId === defaultTargetPeriod.id) {
      return 150;
    }
    return 150;
  });
  mockPrisma.metricPeriod.findFirst.mockResolvedValue(defaultTargetPeriod);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.metricPeriod.findFirst.mockResolvedValue(null);
});

describe("SETUP_TASKS", () => {
  it("has 5 tasks in period-first order", () => {
    expect(SETUP_TASKS).toHaveLength(5);
    expect(SETUP_TASKS.map((t) => t.id)).toEqual([
      "period",
      "metrics",
      "members",
      "data",
      "team",
    ]);
  });

  it("marks period, metrics, members, and data as required; team optional and last", () => {
    expect(SETUP_TASKS.map((t) => ({ id: t.id, required: t.required }))).toEqual([
      { id: "period", required: true },
      { id: "metrics", required: true },
      { id: "members", required: true },
      { id: "data", required: true },
      { id: "team", required: false },
    ]);
  });

  it("keeps admin/leader tasks before optional team invitation", () => {
    const membersIndex = SETUP_TASKS.findIndex((t) => t.id === "members");
    const dataIndex = SETUP_TASKS.findIndex((t) => t.id === "data");
    const teamIndex = SETUP_TASKS.findIndex((t) => t.id === "team");

    expect(membersIndex).toBeLessThan(teamIndex);
    expect(dataIndex).toBeLessThan(teamIndex);
    expect(SETUP_TASKS.at(-1)?.id).toBe("team");
  });

  it("has required permissions for each task", () => {
    expect(SETUP_TASKS[0].requiredPermission).toBe("canConfigurePeriods");
    expect(SETUP_TASKS[1].requiredPermission).toBe("canConfigureMetrics");
    expect(SETUP_TASKS[2].requiredPermission).toBe("canImportMembers");
    expect(SETUP_TASKS[3].requiredPermission).toBe("canImportMetrics");
    expect(SETUP_TASKS[4].requiredPermission).toBe("canInviteCollaborators");
  });

  it("generates correct hrefs", () => {
    const allianceId = "test-alliance-id";

    expect(SETUP_TASKS[0].href(allianceId)).toBe(`/alliances/${allianceId}/periods`);
    expect(SETUP_TASKS[1].href(allianceId)).toBe(`/alliances/${allianceId}/metrics`);
    expect(SETUP_TASKS[2].href(allianceId)).toBe(`/alliances/${allianceId}/members/import`);
    expect(SETUP_TASKS[3].href(allianceId)).toBe(`/alliances/${allianceId}/periods`);
    expect(SETUP_TASKS[4].href(allianceId)).toBe(`/alliances/${allianceId}/settings/invitations`);
  });
});

describe("SETUP_TASK_TOURS", () => {
  it("only keys real setup tasks", () => {
    const taskIds = new Set(SETUP_TASKS.map((t) => t.id));
    for (const taskId of Object.keys(SETUP_TASK_TOURS)) {
      expect(taskIds.has(taskId as (typeof SETUP_TASKS)[number]["id"])).toBe(
        true,
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
    expect(status.requiredTotal).toBe(4);
    expect(status.tasks.every((t) => !t.completed)).toBe(true);
    expect(status.targetPeriodId).toBeNull();
    expect(status.hasArchivedPeriodsOnly).toBe(false);
  });

  it("returns all tasks complete for fully setup alliance", async () => {
    mockFullyCompleteCounts();

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.isComplete).toBe(true);
    expect(status.completedCount).toBe(5);
    expect(status.totalCount).toBe(5);
    expect(status.requiredComplete).toBe(4);
    expect(status.tasks.every((t) => t.completed)).toBe(true);
  });

  it("stays incomplete until members and data are done, not just period and metrics", async () => {
    mockPrisma.metric.count.mockResolvedValue(2);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.findFirst.mockResolvedValue(defaultTargetPeriod);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.isComplete).toBe(false);
    expect(status.requiredComplete).toBe(2);
    expect(status.tasks.find((t) => t.id === "period")?.completed).toBe(true);
    expect(status.tasks.find((t) => t.id === "metrics")?.completed).toBe(true);
    expect(status.tasks.find((t) => t.id === "members")?.completed).toBe(false);
    expect(status.tasks.find((t) => t.id === "data")?.completed).toBe(false);
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

    mockPrisma.invitation.count.mockResolvedValue(1);
    const status2 = await getAllianceSetupStatus("alliance-1");
    expect(status2.tasks.find((t) => t.id === "team")?.completed).toBe(true);

    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(2);
    const status3 = await getAllianceSetupStatus("alliance-1");
    expect(status3.tasks.find((t) => t.id === "team")?.completed).toBe(true);
  });

  it("includes actionable metadata on tasks", async () => {
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");

    const periodTask = status.tasks.find((t) => t.id === "period");
    expect(periodTask).toMatchObject({
      id: "period",
      label: "Create Evaluation Period",
      completed: false,
      href: "/alliances/alliance-1/periods",
      typicallyCompletedBy: "Founding Operator",
      required: true,
      actionable: true,
    });
  });

  it("blocks the data task when zero members exist", async () => {
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.findFirst.mockResolvedValue(defaultTargetPeriod);

    const leaderPermissions = {
      canViewAlliance: true,
      canViewMembers: true,
      canViewNotes: true,
      canManageNotes: true,
      canImportMetrics: true,
      canManageMembers: false,
      canImportMembers: false,
      canConfigureMetrics: true,
      canConfigurePeriods: true,
      canInviteCollaborators: false,
      canManageLeadership: false,
      canManageAlliance: false,
    };

    const status = await getAllianceSetupStatus("alliance-1", leaderPermissions);
    const dataTask = status.tasks.find((t) => t.id === "data");

    expect(dataTask).toMatchObject({
      completed: false,
      actionable: false,
      blockedReason:
        "An Admin or Owner must import members before you can import evaluation results.",
    });
  });

  it("surfaces archived-only periods for restore/select/create guidance", async () => {
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(2);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.findFirst.mockResolvedValue(null);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.targetPeriodId).toBeNull();
    expect(status.hasArchivedPeriodsOnly).toBe(true);
    expect(status.tasks.find((t) => t.id === "period")?.completed).toBe(false);
  });

  it("filters tasks by permissions when provided", async () => {
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
      canConfigureMetrics: true,
      canConfigurePeriods: true,
      canInviteCollaborators: false,
      canManageLeadership: false,
      canManageAlliance: false,
    };

    const status = await getAllianceSetupStatus("alliance-1", leaderPermissions);

    expect(status.tasks.map((task) => task.id)).toEqual(["period", "metrics", "data"]);
    expect(status.totalCount).toBe(3);
    expect(status.isComplete).toBe(false);
    expect(status.requiredTotal).toBe(4);
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

    expect(status.recommendedTask?.id).toBe("period");
  });

  it("advances the recommendation as earlier tasks complete", async () => {
    mockPrisma.metric.count.mockResolvedValue(2);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.findFirst.mockResolvedValue(defaultTargetPeriod);

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.recommendedTask?.id).toBe("members");
  });

  it("returns null recommendation when all applicable tasks are complete", async () => {
    mockFullyCompleteCounts();

    const status = await getAllianceSetupStatus("alliance-1");

    expect(status.recommendedTask).toBeNull();
  });

  it("recommends only tasks the user can act on (permission-filtered)", async () => {
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
      canConfigureMetrics: true,
      canConfigurePeriods: true,
      canInviteCollaborators: false,
      canManageLeadership: false,
      canManageAlliance: false,
    };

    const status = await getAllianceSetupStatus("alliance-1", leaderPermissions);

    expect(status.recommendedTask?.id).toBe("period");
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
    mockFullyCompleteCounts();

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

    expect(status.tasks).toHaveLength(0);
    expect(status.totalCount).toBe(0);
    expect(status.isComplete).toBe(true);
    expect(status.requiredTotal).toBe(4);
    expect(status.requiredComplete).toBe(4);
  });

  it("targets the active evaluation period directly for evaluation results import href", async () => {
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(5);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.findFirst.mockResolvedValue(defaultTargetPeriod);

    const status = await getAllianceSetupStatus("alliance-1");
    const dataTask = status.tasks.find((t) => t.id === "data");

    expect(dataTask?.href).toBe("/alliances/alliance-1/periods/period-123/import");
  });

  it("targets /import when period has 0 assigned metrics but user can provision metrics", async () => {
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(5);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    mockPrisma.metricPeriod.findFirst.mockResolvedValue({
      id: "period-empty",
      name: "Empty Period",
      periodMetrics: [],
    });

    const leaderPermissions = {
      canViewAlliance: true,
      canViewMembers: true,
      canViewNotes: true,
      canManageNotes: true,
      canImportMetrics: true,
      canManageMembers: false,
      canImportMembers: false,
      canConfigureMetrics: true,
      canConfigurePeriods: true,
      canInviteCollaborators: false,
      canManageLeadership: false,
      canManageAlliance: false,
    };

    const status = await getAllianceSetupStatus("alliance-1", leaderPermissions);
    const dataTask = status.tasks.find((t) => t.id === "data");

    expect(dataTask?.href).toBe("/alliances/alliance-1/periods/period-empty/import");
  });

  it("evaluates metrics completion from target period attachments, not global metric count", async () => {
    mockPrisma.metric.count.mockResolvedValue(5);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.findFirst.mockResolvedValue({
      id: "period-no-metrics",
      name: "Season 7",
      periodMetrics: [],
    });

    const status = await getAllianceSetupStatus("alliance-1");
    const metricsTask = status.tasks.find((t) => t.id === "metrics");

    expect(metricsTask?.completed).toBe(false);
  });

  it("evaluates data setup task as incomplete when historical entries exist but active target period is empty", async () => {
    mockPrisma.metric.count.mockResolvedValue(2);
    mockPrisma.metricPeriod.count.mockResolvedValue(2);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(5);
    mockPrisma.memberMetricEntry.count.mockImplementation(async (args?: { where?: { periodId?: string } }) => {
      if (args?.where?.periodId === "period-active-empty") {
        return 0;
      }
      return 150;
    });

    mockPrisma.metricPeriod.findFirst.mockResolvedValue({
      id: "period-active-empty",
      name: "Active Empty",
      periodMetrics: [{ metricId: "m-1" }],
    });

    const status = await getAllianceSetupStatus("alliance-1");
    const dataTask = status.tasks.find((t) => t.id === "data");

    expect(dataTask?.completed).toBe(false);
  });

  it("selects active period deterministically when multiple active periods exist", async () => {
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(2);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(5);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    mockPrisma.metricPeriod.findFirst.mockResolvedValue({
      id: "period-latest-active",
      name: "Latest Active",
      periodMetrics: [{ metricId: "m-1" }],
    });

    await getAllianceSetupStatus("alliance-1");

    expect(mockPrisma.metricPeriod.findFirst).toHaveBeenCalledWith({
      where: { allianceId: "alliance-1", active: true },
      orderBy: metricPeriodChronologicalOrderBy,
      select: expect.objectContaining({
        id: true,
        name: true,
        periodMetrics: expect.any(Object),
      }),
    });
  });

  it("treats period with only inactive metric attachments as having 0 assigned metrics", async () => {
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(5);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    mockPrisma.metricPeriod.findFirst.mockResolvedValue({
      id: "period-inactive-attachment",
      name: "Inactive Attachment",
      periodMetrics: [],
    });

    const viewerPermissions = {
      canViewAlliance: true,
      canViewMembers: true,
      canViewNotes: true,
      canManageNotes: false,
      canImportMetrics: true,
      canManageMembers: false,
      canImportMembers: false,
      canConfigureMetrics: false,
      canConfigurePeriods: false,
      canInviteCollaborators: false,
      canManageLeadership: false,
      canManageAlliance: false,
    };

    const status = await getAllianceSetupStatus("alliance-1", viewerPermissions);
    const dataTask = status.tasks.find((t) => t.id === "data");

    expect(dataTask?.href).toBe("/alliances/alliance-1/periods/period-inactive-attachment");
  });

  it("remains incomplete when target period only has entries for inactive metric attachments", async () => {
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(1);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.invitation.count.mockResolvedValue(0);
    mockPrisma.allianceMember.count.mockResolvedValue(5);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(50);

    mockPrisma.metricPeriod.findFirst.mockResolvedValue({
      id: "period-with-inactive-entries",
      name: "Inactive Entries",
      periodMetrics: [],
    });

    const status = await getAllianceSetupStatus("alliance-1");
    const dataTask = status.tasks.find((t) => t.id === "data");

    expect(dataTask?.completed).toBe(false);
  });
});
