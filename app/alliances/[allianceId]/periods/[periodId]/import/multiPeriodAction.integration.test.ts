import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as MultiPeriodAction from "./multiPeriodAction";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
  requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("importMultiPeriodMetrics [integration]", () => {
  let prisma: PrismaClient;
  let importMultiPeriodMetrics: typeof MultiPeriodAction.importMultiPeriodMetrics;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
    ({ importMultiPeriodMetrics } = await import("./multiPeriodAction"));
  });

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(requireAllianceAccess).mockResolvedValue({
      user: { id: "integration-test-user", email: "test@local" },
      permissions: {
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
      },
      membership: { role: "ADMIN" } as unknown as Awaited<
        ReturnType<typeof requireAllianceAccess>
      >["membership"],
    });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.memberMetricEntry.deleteMany({
        where: { allianceMember: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriodMetric.deleteMany({
        where: { period: { allianceId: { in: createdAllianceIds } } },
      });
      await prisma.metricPeriod.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.metric.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.allianceMember.deleteMany({
        where: { allianceId: { in: createdAllianceIds } },
      });
      await prisma.alliance.deleteMany({
        where: { id: { in: createdAllianceIds } },
      });
      createdAllianceIds.length = 0;
    }
  });

  async function makeTestSetup() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: {
        name: `Multi Import Alliance ${suffix}`,
        server: "1001",
      },
    });
    createdAllianceIds.push(alliance.id);

    const member = await prisma.allianceMember.create({
      data: {
        allianceId: alliance.id,
        playerName: "Test Player 1",
      },
    });

    const periodA = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Period A", active: true },
    });
    const periodB = await prisma.metricPeriod.create({
      data: { allianceId: alliance.id, name: "Period B", active: true },
    });

    const killsA = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Kills A", type: "NUMERIC" },
    });
    const killsB = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Kills B", type: "NUMERIC" },
    });

    await prisma.metricPeriodMetric.create({
      data: {
        periodId: periodA.id,
        metricId: killsA.id,
        active: true,
        weight: 1,
        required: false,
      },
    });
    await prisma.metricPeriodMetric.create({
      data: {
        periodId: periodB.id,
        metricId: killsB.id,
        active: true,
        weight: 1,
        required: false,
      },
    });

    return { alliance, member, periodA, periodB, killsA, killsB };
  }

  it("imports into two existing periods atomically", async () => {
    const { alliance, member, periodA, periodB, killsA, killsB } = await makeTestSetup();

    const result = await importMultiPeriodMetrics({
      allianceId: alliance.id,
      groups: [
        {
          targetPeriodId: periodA.id,
          mappings: [
            {
              sourceColumnName: "Kills on 3/29",
              target: { kind: "existing", metricId: killsA.id },
              entries: [{ memberId: member.id, rawValue: "100" }],
            },
          ],
        },
        {
          targetPeriodId: periodB.id,
          mappings: [
            {
              sourceColumnName: "Kills on 4/13",
              target: { kind: "existing", metricId: killsB.id },
              entries: [{ memberId: member.id, rawValue: "200" }],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.periods).toHaveLength(2);
    expect(result.totalCount).toBe(2);

    const entriesA = await prisma.memberMetricEntry.findMany({ where: { periodId: periodA.id } });
    const entriesB = await prisma.memberMetricEntry.findMany({ where: { periodId: periodB.id } });
    expect(entriesA).toHaveLength(1);
    expect(entriesB).toHaveLength(1);
    expect(entriesA[0].value).toBe(100);
    expect(entriesB[0].value).toBe(200);
  });

  it("rejects when a target period does not belong to the alliance", async () => {
    const setup1 = await makeTestSetup();
    const setup2 = await makeTestSetup();

    await expect(
      importMultiPeriodMetrics({
        allianceId: setup2.alliance.id,
        groups: [
          {
            targetPeriodId: setup1.periodA.id,
            mappings: [
              {
                sourceColumnName: "Kills",
                target: { kind: "existing", metricId: setup1.killsA.id },
                entries: [{ memberId: setup2.member.id, rawValue: "1" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/not found for this alliance/i);

    const count = await prisma.memberMetricEntry.count({
      where: { periodId: setup1.periodA.id },
    });
    expect(count).toBe(0);
  });

  it("requires CONFIGURE_PERIODS when attaching a library metric in any group", async () => {
    const { alliance, member, periodA, periodB } = await makeTestSetup();
    const libraryMetric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Library Only", type: "NUMERIC" },
    });

    vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
      user: { id: "integration-test-user", email: "test@local" },
      permissions: {
        canImportMetrics: true,
        canConfigurePeriods: false,
        canConfigureMetrics: false,
      } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
      membership: { role: "LEADER" } as unknown as Awaited<
        ReturnType<typeof requireAllianceAccess>
      >["membership"],
    });

    await expect(
      importMultiPeriodMetrics({
        allianceId: alliance.id,
        groups: [
          {
            targetPeriodId: periodA.id,
            mappings: [
              {
                sourceColumnName: "Attached",
                target: { kind: "existing", metricId: libraryMetric.id },
                entries: [{ memberId: member.id, rawValue: "5" }],
              },
            ],
          },
          {
            targetPeriodId: periodB.id,
            mappings: [
              {
                sourceColumnName: "Also Attached",
                target: { kind: "existing", metricId: libraryMetric.id },
                entries: [{ memberId: member.id, rawValue: "6" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/permission to create or attach metrics/i);

    expect(await prisma.memberMetricEntry.count({ where: { periodId: periodA.id } })).toBe(0);
    expect(await prisma.memberMetricEntry.count({ where: { periodId: periodB.id } })).toBe(0);
  });

  it("rolls back all groups when a member fails alliance validation", async () => {
    const setup1 = await makeTestSetup();
    const setup2 = await makeTestSetup();

    await expect(
      importMultiPeriodMetrics({
        allianceId: setup1.alliance.id,
        groups: [
          {
            targetPeriodId: setup1.periodA.id,
            mappings: [
              {
                sourceColumnName: "Kills A",
                target: { kind: "existing", metricId: setup1.killsA.id },
                entries: [{ memberId: setup1.member.id, rawValue: "10" }],
              },
            ],
          },
          {
            targetPeriodId: setup1.periodB.id,
            mappings: [
              {
                sourceColumnName: "Kills B",
                target: { kind: "existing", metricId: setup1.killsB.id },
                entries: [{ memberId: setup2.member.id, rawValue: "20" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/do not belong to this alliance/i);

    expect(
      await prisma.memberMetricEntry.count({
        where: { allianceMember: { allianceId: setup1.alliance.id } },
      }),
    ).toBe(0);
  });

  it("rolls back first period entries when a later group fails inside the transaction", async () => {
    const { alliance, member, periodA, periodB, killsA, killsB } = await makeTestSetup();
    const { prisma } = await import("@/app/src/lib/prisma");

    let createManyCalls = 0;
    const originalTransaction = prisma.$transaction.bind(prisma);
    vi.spyOn(prisma, "$transaction").mockImplementation(async (fn) =>
      originalTransaction(async (tx) => {
        const originalCreateMany = tx.memberMetricEntry.createMany.bind(tx.memberMetricEntry);
        vi.spyOn(tx.memberMetricEntry, "createMany").mockImplementation((async (args) => {
          createManyCalls += 1;
          if (createManyCalls > 1) {
            throw new Error("Simulated in-transaction insert failure");
          }
          return originalCreateMany(args!);
        }) as typeof tx.memberMetricEntry.createMany);
        return fn(tx);
      }),
    );

    await expect(
      importMultiPeriodMetrics({
        allianceId: alliance.id,
        groups: [
          {
            targetPeriodId: periodA.id,
            mappings: [
              {
                sourceColumnName: "Kills A",
                target: { kind: "existing", metricId: killsA.id },
                entries: [{ memberId: member.id, rawValue: "10" }],
              },
            ],
          },
          {
            targetPeriodId: periodB.id,
            mappings: [
              {
                sourceColumnName: "Kills B",
                target: { kind: "existing", metricId: killsB.id },
                entries: [{ memberId: member.id, rawValue: "20" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/Simulated in-transaction insert failure/i);

    expect(await prisma.memberMetricEntry.count({ where: { periodId: periodA.id } })).toBe(0);
    expect(await prisma.memberMetricEntry.count({ where: { periodId: periodB.id } })).toBe(0);
  });

  it("rejects duplicate target period ids in one submission", async () => {
    const { alliance, member, periodA, killsA } = await makeTestSetup();

    await expect(
      importMultiPeriodMetrics({
        allianceId: alliance.id,
        groups: [
          {
            targetPeriodId: periodA.id,
            mappings: [
              {
                sourceColumnName: "Col 1",
                target: { kind: "existing", metricId: killsA.id },
                entries: [{ memberId: member.id, rawValue: "1" }],
              },
            ],
          },
          {
            targetPeriodId: periodA.id,
            mappings: [
              {
                sourceColumnName: "Col 2",
                target: { kind: "existing", metricId: killsA.id },
                entries: [{ memberId: member.id, rawValue: "2" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/only appear once/i);
  });
});
