import { describe, it, expect, beforeAll, afterEach, beforeEach, vi } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import type * as ImportAction from "./action";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";

vi.mock("next/cache", () => ({
    revalidatePath: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/requireAllianceAccess", () => ({
    requireAllianceAccess: vi.fn(),
}));

const runDb = process.env.INTEGRATION_DB === "true";

describe.skipIf(!runDb)("importMemberMetrics [integration]", () => {
    let prisma: PrismaClient;
    let importMemberMetrics: typeof ImportAction.importMemberMetrics;
    const createdAllianceIds: string[] = [];

    beforeAll(async () => {
        ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
            prisma: PrismaClient;
        });
        ({ importMemberMetrics } = await import("./action"));
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
                canConfigureMetrics: false,
                canConfigurePeriods: false,
                canInviteCollaborators: false,
                canManageLeadership: false,
                canManageAlliance: false,
                canRollbackMemberImports: false,
            },
            membership: { role: "LEADER" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
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
                name: `Metrics Import Alliance ${suffix}`,
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
            data: {
                allianceId: alliance.id,
                name: "Period A",
            },
        });

        const periodB = await prisma.metricPeriod.create({
            data: {
                allianceId: alliance.id,
                name: "Period B",
            },
        });

        const attachedMetric = await prisma.metric.create({
            data: {
                allianceId: alliance.id,
                name: "Attached Metric",
                type: "NUMERIC",
            },
        });

        await prisma.metricPeriodMetric.create({
            data: {
                periodId: periodA.id,
                metricId: attachedMetric.id,
                active: true,
                weight: 1,
                required: false,
            },
        });

        const libraryMetric = await prisma.metric.create({
            data: {
                allianceId: alliance.id,
                name: "Unattached Library Metric",
                type: "NUMERIC",
            },
        });

        return { alliance, member, periodA, periodB, attachedMetric, libraryMetric };
    }

    it("requires IMPORT_METRICS for existing attached metric import", async () => {
        const { alliance, member, periodA, attachedMetric } = await makeTestSetup();

        vi.mocked(requireAllianceAccess).mockRejectedValueOnce(
            new Error("Forbidden: Missing required permission canImportMetrics")
        );

        await expect(
            importMemberMetrics({
                periodId: periodA.id,
                allianceId: alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Attached Metric",
                        target: { kind: "existing", metricId: attachedMetric.id },
                        entries: [{ memberId: member.id, rawValue: "100" }],
                    },
                ],
            })
        ).rejects.toThrow("Forbidden: Missing required permission canImportMetrics");

        const entriesCount = await prisma.memberMetricEntry.count({
            where: { periodId: periodA.id },
        });
        expect(entriesCount).toBe(0);
    });

    it("requires CONFIGURE_PERIODS in addition to IMPORT_METRICS to attach a library metric", async () => {
        const { alliance, member, periodA, libraryMetric } = await makeTestSetup();

        // User has canImportMetrics: true, but canConfigurePeriods: false
        await expect(
            importMemberMetrics({
                periodId: periodA.id,
                allianceId: alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Library Metric",
                        target: { kind: "existing", metricId: libraryMetric.id },
                        entries: [{ memberId: member.id, rawValue: "100" }],
                    },
                ],
            })
        ).rejects.toThrow("You do not have permission to create or attach metrics during import");

        // Verify zero attachments and zero entries created
        const attachmentCount = await prisma.metricPeriodMetric.count({
            where: { periodId: periodA.id, metricId: libraryMetric.id },
        });
        expect(attachmentCount).toBe(0);

        const entriesCount = await prisma.memberMetricEntry.count({
            where: { periodId: periodA.id },
        });
        expect(entriesCount).toBe(0);
    });

    it("attaches library metric when user has CONFIGURE_PERIODS", async () => {
        const { alliance, member, periodA, libraryMetric } = await makeTestSetup();

        vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
            user: { id: "integration-test-user", email: "test@local" },
            permissions: {
                canImportMetrics: true,
                canConfigurePeriods: true,
                canConfigureMetrics: false,
            } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
            membership: { role: "LEADER" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
        });

        const result = await importMemberMetrics({
            periodId: periodA.id,
            allianceId: alliance.id,
            mappings: [
                {
                    sourceColumnName: "Library Metric",
                    target: { kind: "existing", metricId: libraryMetric.id },
                    entries: [{ memberId: member.id, rawValue: "100" }],
                },
            ],
        });

        expect(result.success).toBe(true);
        expect(result.totalCount).toBe(1);

        const attachment = await prisma.metricPeriodMetric.findFirst({
            where: { periodId: periodA.id, metricId: libraryMetric.id, active: true },
        });
        expect(attachment).not.toBeNull();
    });

    it("requires CONFIGURE_METRICS to create a brand new metric during import", async () => {
        const { alliance, member, periodA } = await makeTestSetup();

        // User has canImportMetrics: true and canConfigurePeriods: true, but canConfigureMetrics: false
        vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
            user: { id: "integration-test-user", email: "test@local" },
            permissions: {
                canImportMetrics: true,
                canConfigurePeriods: true,
                canConfigureMetrics: false,
            } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
            membership: { role: "LEADER" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
        });

        await expect(
            importMemberMetrics({
                periodId: periodA.id,
                allianceId: alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Brand New Metric",
                        target: { kind: "create", name: "Brand New Metric" },
                        entries: [{ memberId: member.id, rawValue: "200" }],
                    },
                ],
            })
        ).rejects.toThrow("You do not have permission to create a metric for column 'Brand New Metric'");

        // Verify metric was NOT created and no result rows were created
        const createdMetric = await prisma.metric.findFirst({
            where: { allianceId: alliance.id, name: "Brand New Metric" },
        });
        expect(createdMetric).toBeNull();

        const entriesCount = await prisma.memberMetricEntry.count({
            where: { periodId: periodA.id },
        });
        expect(entriesCount).toBe(0);
    });

    it("creates new metric when user has CONFIGURE_METRICS permission", async () => {
        const { alliance, member, periodA } = await makeTestSetup();

        vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
            user: { id: "integration-test-user", email: "test@local" },
            permissions: {
                canImportMetrics: true,
                canConfigurePeriods: true,
                canConfigureMetrics: true,
            } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
            membership: { role: "ADMIN" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
        });

        const result = await importMemberMetrics({
            periodId: periodA.id,
            allianceId: alliance.id,
            mappings: [
                {
                    sourceColumnName: "Brand New Metric",
                    target: { kind: "create", name: "Brand New Metric" },
                    entries: [{ memberId: member.id, rawValue: "200" }],
                },
            ],
        });

        expect(result.success).toBe(true);
        expect(result.created).toHaveLength(1);
        expect(result.created[0].name).toBe("Brand New Metric");

        const createdMetric = await prisma.metric.findFirst({
            where: { allianceId: alliance.id, name: "Brand New Metric" },
        });
        expect(createdMetric).not.toBeNull();
    });

    it("writes observationGrain re-fetched from each resolved metric's own grain, and status ACTIVE explicitly, for both an existing attach and a mid-transaction create (ADR-018 §3)", async () => {
        const { alliance, member, periodA, libraryMetric } = await makeTestSetup();

        vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
            user: { id: "integration-test-user", email: "test@local" },
            permissions: {
                canImportMetrics: true,
                canConfigurePeriods: true,
                canConfigureMetrics: true,
            } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
            membership: { role: "ADMIN" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
        });

        await importMemberMetrics({
            periodId: periodA.id,
            allianceId: alliance.id,
            mappings: [
                {
                    sourceColumnName: "Library Metric",
                    target: { kind: "existing", metricId: libraryMetric.id },
                    entries: [{ memberId: member.id, rawValue: "100" }],
                },
                {
                    sourceColumnName: "Brand New Metric",
                    target: { kind: "create", name: "Brand New Metric" },
                    entries: [{ memberId: member.id, rawValue: "200" }],
                },
            ],
        });

        const entries = await prisma.memberMetricEntry.findMany({
            where: { periodId: periodA.id },
        });
        expect(entries).toHaveLength(2);
        for (const entry of entries) {
            expect(entry.observationGrain).toBe("PERIOD_VALUE");
            expect(entry.status).toBe("ACTIVE");
        }
    });

    it("rejects import when period belongs to another alliance", async () => {
        const setup1 = await makeTestSetup();
        const setup2 = await makeTestSetup();

        // Try importing setup2 member into setup1's period via setup2's alliance context
        await expect(
            importMemberMetrics({
                periodId: setup1.periodA.id,
                allianceId: setup2.alliance.id, // mismatch
                mappings: [
                    {
                        sourceColumnName: "Attached Metric",
                        target: { kind: "existing", metricId: setup2.attachedMetric.id },
                        entries: [{ memberId: setup2.member.id, rawValue: "100" }],
                    },
                ],
            })
        ).rejects.toThrow("Period not found");
    });

    it("rejects import when member belongs to another alliance", async () => {
        const setup1 = await makeTestSetup();
        const setup2 = await makeTestSetup();

        await expect(
            importMemberMetrics({
                periodId: setup1.periodA.id,
                allianceId: setup1.alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Attached Metric",
                        target: { kind: "existing", metricId: setup1.attachedMetric.id },
                        entries: [{ memberId: setup2.member.id, rawValue: "100" }], // member from setup2
                    },
                ],
            })
        ).rejects.toThrow("One or more members do not belong to this alliance");
    });

    it("rejects import when metric belongs to another alliance", async () => {
        const setup1 = await makeTestSetup();
        const setup2 = await makeTestSetup();

        await expect(
            importMemberMetrics({
                periodId: setup1.periodA.id,
                allianceId: setup1.alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Attached Metric",
                        target: { kind: "existing", metricId: setup2.attachedMetric.id }, // metric from setup2
                        entries: [{ memberId: setup1.member.id, rawValue: "100" }],
                    },
                ],
            })
        ).rejects.toThrow("One or more metrics do not belong to this alliance");
    });

    it("rejects import when attach target references a metric from another alliance with zero writes", async () => {
        const setup1 = await makeTestSetup();
        const setup2 = await makeTestSetup();

        const initialAttachmentCount = await prisma.metricPeriodMetric.count({
            where: { periodId: setup1.periodA.id },
        });
        const initialEntryCount = await prisma.memberMetricEntry.count({
            where: { periodId: setup1.periodA.id },
        });

        await expect(
            importMemberMetrics({
                periodId: setup1.periodA.id,
                allianceId: setup1.alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Foreign Attach",
                        target: { kind: "attach", metricId: setup2.libraryMetric.id },
                        entries: [{ memberId: setup1.member.id, rawValue: "100" }],
                    },
                ],
            }),
        ).rejects.toThrow("One or more metrics do not belong to this alliance");

        expect(
            await prisma.metricPeriodMetric.count({
                where: { periodId: setup1.periodA.id },
            }),
        ).toBe(initialAttachmentCount);
        expect(
            await prisma.memberMetricEntry.count({
                where: { periodId: setup1.periodA.id },
            }),
        ).toBe(initialEntryCount);
    });

    it("import into Period A leaves Period B completely unchanged", async () => {
        const { alliance, member, periodA, periodB, attachedMetric } = await makeTestSetup();

        await importMemberMetrics({
            periodId: periodA.id,
            allianceId: alliance.id,
            mappings: [
                {
                    sourceColumnName: "Attached Metric",
                    target: { kind: "existing", metricId: attachedMetric.id },
                    entries: [{ memberId: member.id, rawValue: "500" }],
                },
            ],
        });

        // Verify Period A has 1 entry
        const periodAEntries = await prisma.memberMetricEntry.findMany({
            where: { periodId: periodA.id },
        });
        expect(periodAEntries).toHaveLength(1);
        expect(periodAEntries[0].value).toBe(500);

        // Verify Period B has 0 entries
        const periodBEntries = await prisma.memberMetricEntry.findMany({
            where: { periodId: periodB.id },
        });
        expect(periodBEntries).toHaveLength(0);
    });

    it("integration: persists localized evaluation result string strictly into PostgreSQL (450.000.000 -> 450000000)", async () => {
        const { alliance, member, periodA, attachedMetric } = await makeTestSetup();

        const result = await importMemberMetrics({
            periodId: periodA.id,
            allianceId: alliance.id,
            mappings: [
                {
                    sourceColumnName: "Attached Metric",
                    target: { kind: "existing", metricId: attachedMetric.id },
                    entries: [{ memberId: member.id, rawValue: "450.000.000" }],
                },
            ],
        });

        expect(result.success).toBe(true);

        const entry = await prisma.memberMetricEntry.findFirst({
            where: { periodId: periodA.id, allianceMemberId: member.id },
        });

        expect(entry).not.toBeNull();
        expect(entry?.value).toBe(450000000);
    });

    it("integration: performs zero database writes (metrics, period attachments, entries) when raw submitted evaluation value is invalid (450.5) or out-of-range (2147483648)", async () => {
        const { alliance, member, periodA, attachedMetric } = await makeTestSetup();

        const initialMetricCount = await prisma.metric.count({ where: { allianceId: alliance.id } });
        const initialAttachmentCount = await prisma.metricPeriodMetric.count({ where: { periodId: periodA.id } });

        // Case 1: Invalid value for existing attached metric
        await expect(
            importMemberMetrics({
                periodId: periodA.id,
                allianceId: alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Attached Metric",
                        target: { kind: "existing", metricId: attachedMetric.id },
                        entries: [{ memberId: member.id, rawValue: "450.5" }],
                    },
                ],
            })
        ).rejects.toThrow(/Invalid integer value "450.5"/i);

        // Case 2: Out of 32-bit signed integer range value for existing attached metric
        await expect(
            importMemberMetrics({
                periodId: periodA.id,
                allianceId: alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Attached Metric",
                        target: { kind: "existing", metricId: attachedMetric.id },
                        entries: [{ memberId: member.id, rawValue: "2147483648" }],
                    },
                ],
            })
        ).rejects.toThrow(/out of 32-bit signed integer range/i);

        // Case 3: Invalid value for new metric creation during import
        await expect(
            importMemberMetrics({
                periodId: periodA.id,
                allianceId: alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Never Created Metric",
                        target: { kind: "create", name: "Never Created Metric" },
                        entries: [{ memberId: member.id, rawValue: "invalid_num" }],
                    },
                ],
            })
        ).rejects.toThrow(/Invalid integer value "invalid_num"/i);

        // Assert ZERO writes for metrics, period-metric attachments, and metric entries
        const finalMetricCount = await prisma.metric.count({ where: { allianceId: alliance.id } });
        const finalAttachmentCount = await prisma.metricPeriodMetric.count({ where: { periodId: periodA.id } });
        const entriesCount = await prisma.memberMetricEntry.count({
            where: { periodId: periodA.id },
        });

        expect(finalMetricCount).toBe(initialMetricCount);
        expect(finalAttachmentCount).toBe(initialAttachmentCount);
        expect(entriesCount).toBe(0);
    });

    it("rejects metric creation for period-like or ambiguous column when user lacks CONFIGURE_METRICS permission", async () => {
        const { alliance, member, periodA } = await makeTestSetup();

        vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
            user: { id: "integration-test-user", email: "test@local" },
            permissions: {
                canImportMetrics: true,
                canConfigurePeriods: true,
                canConfigureMetrics: false,
            } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
            membership: { role: "LEADER" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
        });

        await expect(
            importMemberMetrics({
                periodId: periodA.id,
                allianceId: alliance.id,
                mappings: [
                    {
                        sourceColumnName: "VS 7",
                        target: { kind: "create", name: "VS 7" },
                        entries: [{ memberId: member.id, rawValue: "1500" }],
                    },
                ],
            })
        ).rejects.toThrow(/You do not have permission to create a metric for column 'VS 7'/i);
    });

    describe("BOOLEAN metric value enforcement (#190)", () => {
        it("rejects a non-0/1 value for an existing attached BOOLEAN metric with zero writes", async () => {
            const { alliance, member, periodA } = await makeTestSetup();
            const boolMetric = await prisma.metric.create({
                data: { allianceId: alliance.id, name: "Attendance", type: "BOOLEAN" },
            });
            await prisma.metricPeriodMetric.create({
                data: { periodId: periodA.id, metricId: boolMetric.id, weight: 1, required: false },
            });

            await expect(
                importMemberMetrics({
                    periodId: periodA.id,
                    allianceId: alliance.id,
                    mappings: [
                        {
                            sourceColumnName: "Attendance",
                            target: { kind: "existing", metricId: boolMetric.id },
                            entries: [{ memberId: member.id, rawValue: "2" }],
                        },
                    ],
                }),
            ).rejects.toThrow("Boolean metric values must be exactly 0 or 1");

            const entriesCount = await prisma.memberMetricEntry.count({
                where: { periodId: periodA.id, metricId: boolMetric.id },
            });
            expect(entriesCount).toBe(0);
        });

        it("accepts 0 and 1 for an existing attached BOOLEAN metric", async () => {
            const { alliance, member, periodA } = await makeTestSetup();
            const boolMetric = await prisma.metric.create({
                data: { allianceId: alliance.id, name: "Attendance", type: "BOOLEAN" },
            });
            await prisma.metricPeriodMetric.create({
                data: { periodId: periodA.id, metricId: boolMetric.id, weight: 1, required: false },
            });

            const result = await importMemberMetrics({
                periodId: periodA.id,
                allianceId: alliance.id,
                mappings: [
                    {
                        sourceColumnName: "Attendance",
                        target: { kind: "existing", metricId: boolMetric.id },
                        entries: [{ memberId: member.id, rawValue: "1" }],
                    },
                ],
            });

            expect(result.success).toBe(true);
            const entry = await prisma.memberMetricEntry.findFirst({
                where: { periodId: periodA.id, metricId: boolMetric.id },
            });
            expect(entry?.value).toBe(1);
        });

        it("rejects a non-0/1 value against a BOOLEAN metric only resolved mid-transaction (a 'create' target that name-matches an existing library metric)", async () => {
            const { alliance, member, periodA } = await makeTestSetup();
            // Not attached to periodA yet — resolveMetricTargets will attach it
            // as part of this import's transaction, so its authoritative type
            // is only knowable *after* resolution, not from any pre-resolution
            // snapshot.
            const boolMetric = await prisma.metric.create({
                data: { allianceId: alliance.id, name: "Attendance", type: "BOOLEAN" },
            });

            vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
                user: { id: "integration-test-user", email: "test@local" },
                permissions: {
                    canImportMetrics: true,
                    canConfigurePeriods: true,
                    canConfigureMetrics: true,
                } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
                membership: { role: "ADMIN" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
            });

            const initialAttachmentCount = await prisma.metricPeriodMetric.count({
                where: { periodId: periodA.id, metricId: boolMetric.id },
            });

            await expect(
                importMemberMetrics({
                    periodId: periodA.id,
                    allianceId: alliance.id,
                    mappings: [
                        {
                            // "create" intent that classifyTargets downgrades to
                            // "attach" because the name already matches boolMetric.
                            sourceColumnName: "Attendance",
                            target: { kind: "create", name: "Attendance" },
                            entries: [{ memberId: member.id, rawValue: "5" }],
                        },
                    ],
                }),
            ).rejects.toThrow("Boolean metric values must be exactly 0 or 1");

            // The whole transaction (including the mid-transaction attach) rolled back.
            const finalAttachmentCount = await prisma.metricPeriodMetric.count({
                where: { periodId: periodA.id, metricId: boolMetric.id },
            });
            expect(finalAttachmentCount).toBe(initialAttachmentCount);

            const entriesCount = await prisma.memberMetricEntry.count({
                where: { periodId: periodA.id, metricId: boolMetric.id },
            });
            expect(entriesCount).toBe(0);
        });
    });

    describe("DAILY_OBSERVATION metric rejection (#287)", () => {
        it("rejects import against an existing attached DAILY_OBSERVATION metric with zero writes, since this importer cannot collect observedOn", async () => {
            const { alliance, member, periodA } = await makeTestSetup();
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
                importMemberMetrics({
                    periodId: periodA.id,
                    allianceId: alliance.id,
                    mappings: [
                        {
                            sourceColumnName: "Daily VS",
                            target: { kind: "existing", metricId: dailyMetric.id },
                            entries: [{ memberId: member.id, rawValue: "10" }],
                        },
                    ],
                }),
            ).rejects.toThrow(/daily observations/i);

            const entriesCount = await prisma.memberMetricEntry.count({
                where: { periodId: periodA.id, metricId: dailyMetric.id },
            });
            expect(entriesCount).toBe(0);
        });

        it("rejects import against a DAILY_OBSERVATION metric only resolved mid-transaction (a 'create' target that name-matches an existing library metric), rolling back the mid-transaction attach", async () => {
            const { alliance, member, periodA } = await makeTestSetup();
            // Not attached to periodA yet — resolveMetricTargets will attach it
            // as part of this import's transaction, so its authoritative grain
            // is only knowable *after* resolution, not from any pre-resolution
            // snapshot.
            const dailyMetric = await prisma.metric.create({
                data: {
                    allianceId: alliance.id,
                    name: "Daily VS",
                    type: "NUMERIC",
                    observationGrain: "DAILY_OBSERVATION",
                    memberPeriodRollup: "SUM",
                },
            });

            vi.mocked(requireAllianceAccess).mockResolvedValueOnce({
                user: { id: "integration-test-user", email: "test@local" },
                permissions: {
                    canImportMetrics: true,
                    canConfigurePeriods: true,
                    canConfigureMetrics: true,
                } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["permissions"],
                membership: { role: "ADMIN" } as unknown as Awaited<ReturnType<typeof requireAllianceAccess>>["membership"],
            });

            const initialAttachmentCount = await prisma.metricPeriodMetric.count({
                where: { periodId: periodA.id, metricId: dailyMetric.id },
            });

            await expect(
                importMemberMetrics({
                    periodId: periodA.id,
                    allianceId: alliance.id,
                    mappings: [
                        {
                            // "create" intent that classifyTargets downgrades to
                            // "attach" because the name already matches dailyMetric.
                            sourceColumnName: "Daily VS",
                            target: { kind: "create", name: "Daily VS" },
                            entries: [{ memberId: member.id, rawValue: "10" }],
                        },
                    ],
                }),
            ).rejects.toThrow(/daily observations/i);

            const finalAttachmentCount = await prisma.metricPeriodMetric.count({
                where: { periodId: periodA.id, metricId: dailyMetric.id },
            });
            expect(finalAttachmentCount).toBe(initialAttachmentCount);

            const entriesCount = await prisma.memberMetricEntry.count({
                where: { periodId: periodA.id, metricId: dailyMetric.id },
            });
            expect(entriesCount).toBe(0);
        });
    });
});
