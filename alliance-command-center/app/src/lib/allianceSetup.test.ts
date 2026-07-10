import { describe, it, expect, vi, beforeEach } from "vitest";
import { getAllianceSetupStatus, SETUP_TASKS } from "./allianceSetup";

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

  it("has owner tasks before admin/leader tasks", () => {
    const ownerTasks = SETUP_TASKS.filter(
      (t) => t.typicallyCompletedBy === "Owner"
    );
    const leaderTasks = SETUP_TASKS.filter(
      (t) => t.typicallyCompletedBy === "Admin or Leader"
    );

    expect(ownerTasks).toHaveLength(3);
    expect(leaderTasks).toHaveLength(2);

    const lastOwnerIndex = SETUP_TASKS.findLastIndex(
      (t) => t.typicallyCompletedBy === "Owner"
    );
    const firstLeaderIndex = SETUP_TASKS.findIndex(
      (t) => t.typicallyCompletedBy === "Admin or Leader"
    );

    expect(lastOwnerIndex).toBeLessThan(firstLeaderIndex);
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

describe("getAllianceSetupStatus", () => {
  it("returns all tasks incomplete for new alliance", async () => {
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
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

  it("team task requires more than 1 membership", async () => {
    mockPrisma.metric.count.mockResolvedValue(0);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");
    const teamTask = status.tasks.find((t) => t.id === "team");

    expect(teamTask?.completed).toBe(false);

    mockPrisma.allianceMembership.count.mockResolvedValue(2);
    const status2 = await getAllianceSetupStatus("alliance-1");
    const teamTask2 = status2.tasks.find((t) => t.id === "team");

    expect(teamTask2?.completed).toBe(true);
  });

  it("includes correct task metadata", async () => {
    mockPrisma.metric.count.mockResolvedValue(1);
    mockPrisma.metricPeriod.count.mockResolvedValue(0);
    mockPrisma.allianceMembership.count.mockResolvedValue(1);
    mockPrisma.allianceMember.count.mockResolvedValue(0);
    mockPrisma.memberMetricEntry.count.mockResolvedValue(0);

    const status = await getAllianceSetupStatus("alliance-1");

    const metricsTask = status.tasks.find((t) => t.id === "metrics");
    expect(metricsTask).toEqual({
      id: "metrics",
      label: "Configure Metrics",
      completed: true,
      href: "/alliances/alliance-1/metrics",
      typicallyCompletedBy: "Owner",
    });
  });
});
