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
        canRollbackMemberImports: false,
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
          target: { kind: "existing", periodId: periodA.id },
          mappings: [
            {
              sourceColumnName: "Kills on 3/29",
              target: { kind: "existing", metricId: killsA.id },
              entries: [{ memberId: member.id, rawValue: "100" }],
            },
          ],
        },
        {
          target: { kind: "existing", periodId: periodB.id },
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

  it("writes observationGrain re-fetched per group from each resolved metric's own grain, and status ACTIVE explicitly (ADR-018 §3)", async () => {
    const { alliance, member, periodA, periodB, killsA, killsB } = await makeTestSetup();

    await importMultiPeriodMetrics({
      allianceId: alliance.id,
      groups: [
        {
          target: { kind: "existing", periodId: periodA.id },
          mappings: [
            {
              sourceColumnName: "Kills on 3/29",
              target: { kind: "existing", metricId: killsA.id },
              entries: [{ memberId: member.id, rawValue: "100" }],
            },
          ],
        },
        {
          target: { kind: "existing", periodId: periodB.id },
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

    const entries = await prisma.memberMetricEntry.findMany({
      where: { periodId: { in: [periodA.id, periodB.id] } },
    });
    expect(entries).toHaveLength(2);
    for (const entry of entries) {
      expect(entry.observationGrain).toBe("PERIOD_VALUE");
      expect(entry.status).toBe("ACTIVE");
    }
  });

  it("rejects when a target period does not belong to the alliance", async () => {
    const setup1 = await makeTestSetup();
    const setup2 = await makeTestSetup();

    await expect(
      importMultiPeriodMetrics({
        allianceId: setup2.alliance.id,
        groups: [
          {
            target: { kind: "existing", periodId: setup1.periodA.id },
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

  it("rejects when attach target references a metric from another alliance with zero writes", async () => {
    const setup1 = await makeTestSetup();
    const setup2 = await makeTestSetup();
    const foreignLibraryMetric = await prisma.metric.create({
      data: {
        allianceId: setup2.alliance.id,
        name: "Foreign Library Metric",
        type: "NUMERIC",
      },
    });

    await expect(
      importMultiPeriodMetrics({
        allianceId: setup1.alliance.id,
        groups: [
          {
            target: { kind: "existing", periodId: setup1.periodA.id },
            mappings: [
              {
                sourceColumnName: "Foreign Attach",
                target: { kind: "attach", metricId: foreignLibraryMetric.id },
                entries: [{ memberId: setup1.member.id, rawValue: "10" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow("One or more metrics do not belong to this alliance");

    expect(
      await prisma.metricPeriodMetric.count({
        where: { periodId: setup1.periodA.id, metricId: foreignLibraryMetric.id },
      }),
    ).toBe(0);
    expect(
      await prisma.memberMetricEntry.count({
        where: { periodId: setup1.periodA.id },
      }),
    ).toBe(0);
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
            target: { kind: "existing", periodId: periodA.id },
            mappings: [
              {
                sourceColumnName: "Attached",
                target: { kind: "existing", metricId: libraryMetric.id },
                entries: [{ memberId: member.id, rawValue: "5" }],
              },
            ],
          },
          {
            target: { kind: "existing", periodId: periodB.id },
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
            target: { kind: "existing", periodId: setup1.periodA.id },
            mappings: [
              {
                sourceColumnName: "Kills A",
                target: { kind: "existing", metricId: setup1.killsA.id },
                entries: [{ memberId: setup1.member.id, rawValue: "10" }],
              },
            ],
          },
          {
            target: { kind: "existing", periodId: setup1.periodB.id },
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
            target: { kind: "existing", periodId: periodA.id },
            mappings: [
              {
                sourceColumnName: "Kills A",
                target: { kind: "existing", metricId: killsA.id },
                entries: [{ memberId: member.id, rawValue: "10" }],
              },
            ],
          },
          {
            target: { kind: "existing", periodId: periodB.id },
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
            target: { kind: "existing", periodId: periodA.id },
            mappings: [
              {
                sourceColumnName: "Col 1",
                target: { kind: "existing", metricId: killsA.id },
                entries: [{ memberId: member.id, rawValue: "1" }],
              },
            ],
          },
          {
            target: { kind: "existing", periodId: periodA.id },
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

  it("creates two new periods and imports into one existing period atomically", async () => {
    const { alliance, member, periodA, killsA } = await makeTestSetup();

    const result = await importMultiPeriodMetrics({
      allianceId: alliance.id,
      groups: [
        {
          target: {
            kind: "create",
            name: "March 2026",
            startsAt: "2026-03-01",
            endsAt: "2026-03-31",
          },
          mappings: [
            {
              sourceColumnName: "Kills on 3/29",
              target: { kind: "create", name: "March Kills" },
              entries: [{ memberId: member.id, rawValue: "100" }],
            },
          ],
        },
        {
          target: {
            kind: "create",
            name: "April 2026",
            startsAt: "2026-04-01",
            endsAt: null,
          },
          mappings: [
            {
              sourceColumnName: "Kills on 4/13",
              target: { kind: "create", name: "April Kills" },
              entries: [{ memberId: member.id, rawValue: "200" }],
            },
          ],
        },
        {
          target: { kind: "existing", periodId: periodA.id },
          mappings: [
            {
              sourceColumnName: "Existing period kills",
              target: { kind: "existing", metricId: killsA.id },
              entries: [{ memberId: member.id, rawValue: "300" }],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(true);
    expect(result.periods).toHaveLength(3);
    expect(result.totalCount).toBe(3);

    const createdPeriods = await prisma.metricPeriod.findMany({
      where: {
        allianceId: alliance.id,
        name: { in: ["March 2026", "April 2026"] },
      },
    });
    expect(createdPeriods).toHaveLength(2);

    expect(await prisma.memberMetricEntry.count({ where: { periodId: periodA.id } })).toBe(1);
    expect(
      await prisma.memberMetricEntry.count({
        where: { periodId: { in: createdPeriods.map((period) => period.id) } },
      }),
    ).toBe(2);

    // Metrics created mid-transaction by resolveMetricTargets must carry
    // observationGrain/memberPeriodRollup explicitly - not the schema's
    // temporary Phase 1 default - since neither import flow can yet request
    // DAILY_OBSERVATION (ADR-018 §3).
    const createdMetrics = await prisma.metric.findMany({
      where: { allianceId: alliance.id, name: { in: ["March Kills", "April Kills"] } },
    });
    expect(createdMetrics).toHaveLength(2);
    for (const metric of createdMetrics) {
      expect(metric.observationGrain).toBe("PERIOD_VALUE");
      expect(metric.memberPeriodRollup).toBe("LATEST");
    }
  });

  it("rolls back newly-created period rows when a later group fails inside the transaction", async () => {
    const { alliance, member, periodA, killsA } = await makeTestSetup();
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
            target: {
              kind: "create",
              name: "Rollback Period",
              startsAt: "2026-05-01",
              endsAt: null,
            },
            mappings: [
              {
                sourceColumnName: "First group",
                target: { kind: "create", name: "Rollback Metric" },
                entries: [{ memberId: member.id, rawValue: "10" }],
              },
            ],
          },
          {
            target: { kind: "existing", periodId: periodA.id },
            mappings: [
              {
                sourceColumnName: "Second group",
                target: { kind: "existing", metricId: killsA.id },
                entries: [{ memberId: member.id, rawValue: "20" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow();

    expect(
      await prisma.metricPeriod.count({
        where: { allianceId: alliance.id, name: "Rollback Period" },
      }),
    ).toBe(0);
    expect(
      await prisma.memberMetricEntry.count({
        where: { allianceMember: { allianceId: alliance.id } },
      }),
    ).toBe(0);
  });

  it("requires CONFIGURE_PERIODS when creating a period in any group", async () => {
    const { alliance, member } = await makeTestSetup();

    vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
      user: { id: "integration-test-user", email: "test@local" },
      permissions: {
        canImportMetrics: true,
        canConfigurePeriods: false,
        canConfigureMetrics: true,
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
            target: {
              kind: "create",
              name: "Needs Configure Periods",
              startsAt: null,
              endsAt: null,
            },
            mappings: [
              {
                sourceColumnName: "Kills",
                target: { kind: "create", name: "Kills" },
                entries: [{ memberId: member.id, rawValue: "1" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/permission to create or attach metrics/i);

    expect(
      await prisma.metricPeriod.count({
        where: { allianceId: alliance.id, name: "Needs Configure Periods" },
      }),
    ).toBe(0);
  });

  it("rejects invalid create period fields server-side", async () => {
    const { alliance, member } = await makeTestSetup();

    await expect(
      importMultiPeriodMetrics({
        allianceId: alliance.id,
        groups: [
          {
            target: { kind: "create", name: "   ", startsAt: null, endsAt: null },
            mappings: [
              {
                sourceColumnName: "Kills",
                target: { kind: "create", name: "Kills" },
                entries: [{ memberId: member.id, rawValue: "1" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/name is required/i);

    await expect(
      importMultiPeriodMetrics({
        allianceId: alliance.id,
        groups: [
          {
            target: {
              kind: "create",
              name: "Bad Dates",
              startsAt: "not-a-date",
              endsAt: null,
            },
            mappings: [
              {
                sourceColumnName: "Kills",
                target: { kind: "create", name: "Kills" },
                entries: [{ memberId: member.id, rawValue: "1" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/invalid start date/i);

    await expect(
      importMultiPeriodMetrics({
        allianceId: alliance.id,
        groups: [
          {
            target: {
              kind: "create",
              name: "Reversed Range",
              startsAt: "2026-04-13",
              endsAt: "2026-03-29",
            },
            mappings: [
              {
                sourceColumnName: "Kills",
                target: { kind: "create", name: "Kills" },
                entries: [{ memberId: member.id, rawValue: "1" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/on or before end date/i);
  });

  it("rejects duplicate create period names in one submission", async () => {
    const { alliance, member } = await makeTestSetup();

    await expect(
      importMultiPeriodMetrics({
        allianceId: alliance.id,
        groups: [
          {
            target: {
              kind: "create",
              name: "Same Name",
              startsAt: "2026-03-01",
              endsAt: null,
            },
            mappings: [
              {
                sourceColumnName: "Col 1",
                target: { kind: "create", name: "Metric A" },
                entries: [{ memberId: member.id, rawValue: "1" }],
              },
            ],
          },
          {
            target: {
              kind: "create",
              name: " same name ",
              startsAt: "2026-04-01",
              endsAt: null,
            },
            mappings: [
              {
                sourceColumnName: "Col 2",
                target: { kind: "create", name: "Metric B" },
                entries: [{ memberId: member.id, rawValue: "2" }],
              },
            ],
          },
        ],
      }),
    ).rejects.toThrow(/new period name may only appear once/i);
  });

  describe("BOOLEAN metric value enforcement (#190)", () => {
    it("rejects a non-0/1 value for an existing attached BOOLEAN metric across periods with zero writes", async () => {
      const { alliance, member, periodA, periodB } = await makeTestSetup();
      const boolMetric = await prisma.metric.create({
        data: { allianceId: alliance.id, name: "Attendance", type: "BOOLEAN" },
      });
      await prisma.metricPeriodMetric.create({
        data: { periodId: periodA.id, metricId: boolMetric.id, weight: 1, required: false },
      });

      await expect(
        importMultiPeriodMetrics({
          allianceId: alliance.id,
          groups: [
            {
              target: { kind: "existing", periodId: periodA.id },
              mappings: [
                {
                  sourceColumnName: "Attendance",
                  target: { kind: "existing", metricId: boolMetric.id },
                  entries: [{ memberId: member.id, rawValue: "2" }],
                },
              ],
            },
          ],
        }),
      ).rejects.toThrow("Boolean metric values must be exactly 0 or 1");

      expect(await prisma.memberMetricEntry.count({ where: { periodId: periodA.id } })).toBe(0);
      expect(await prisma.memberMetricEntry.count({ where: { periodId: periodB.id } })).toBe(0);
    });

    it("accepts 0 and 1 for an existing attached BOOLEAN metric", async () => {
      const { alliance, member, periodA } = await makeTestSetup();
      const boolMetric = await prisma.metric.create({
        data: { allianceId: alliance.id, name: "Attendance", type: "BOOLEAN" },
      });
      await prisma.metricPeriodMetric.create({
        data: { periodId: periodA.id, metricId: boolMetric.id, weight: 1, required: false },
      });

      const result = await importMultiPeriodMetrics({
        allianceId: alliance.id,
        groups: [
          {
            target: { kind: "existing", periodId: periodA.id },
            mappings: [
              {
                sourceColumnName: "Attendance",
                target: { kind: "existing", metricId: boolMetric.id },
                entries: [{ memberId: member.id, rawValue: "0" }],
              },
            ],
          },
        ],
      });

      expect(result.success).toBe(true);
      const entry = await prisma.memberMetricEntry.findFirst({
        where: { periodId: periodA.id, metricId: boolMetric.id },
      });
      expect(entry?.value).toBe(0);
    });
  });

  describe("DAILY_OBSERVATION metric rejection (#287)", () => {
    it("rejects a group mapped to a DAILY_OBSERVATION metric with zero writes across every period in the batch, since this importer cannot collect observedOn", async () => {
      const { alliance, member, periodA, periodB, killsB } = await makeTestSetup();
      const dailyMetric = await prisma.metric.create({
        data: {
          allianceId: alliance.id,
          name: "Daily VS",
          type: "NUMERIC",
          observationGrain: "DAILY_OBSERVATION",
          memberPeriodRollup: "SUM",
        },
      });
      await prisma.metricPeriodMetric.create({
        data: { periodId: periodA.id, metricId: dailyMetric.id, weight: 1, required: false },
      });

      await expect(
        importMultiPeriodMetrics({
          allianceId: alliance.id,
          groups: [
            // Ordered first so it actually writes inside the transaction -
            // proving the second group's rejection rolls it back too, not
            // just that it was never attempted.
            {
              target: { kind: "existing", periodId: periodB.id },
              mappings: [
                {
                  sourceColumnName: "Kills B",
                  target: { kind: "existing", metricId: killsB.id },
                  entries: [{ memberId: member.id, rawValue: "20" }],
                },
              ],
            },
            {
              target: { kind: "existing", periodId: periodA.id },
              mappings: [
                {
                  sourceColumnName: "Daily VS",
                  target: { kind: "existing", metricId: dailyMetric.id },
                  entries: [{ memberId: member.id, rawValue: "10" }],
                },
              ],
            },
          ],
        }),
      ).rejects.toThrow(/daily observations/i);

      // The whole transaction rolled back - including Period B's write,
      // which succeeded before Period A's group was rejected.
      expect(await prisma.memberMetricEntry.count({ where: { periodId: periodA.id } })).toBe(0);
      expect(await prisma.memberMetricEntry.count({ where: { periodId: periodB.id } })).toBe(0);
    });
  });
});
