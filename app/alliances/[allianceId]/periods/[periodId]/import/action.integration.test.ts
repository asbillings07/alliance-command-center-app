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
                        target: { kind: "existing", metricId: attachedMetric.id },
                        entries: [{ memberId: member.id, value: 100 }],
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
                        target: { kind: "existing", metricId: libraryMetric.id },
                        entries: [{ memberId: member.id, value: 100 }],
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
                    target: { kind: "existing", metricId: libraryMetric.id },
                    entries: [{ memberId: member.id, value: 100 }],
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
                        target: { kind: "create", name: "Brand New Metric" },
                        entries: [{ memberId: member.id, value: 200 }],
                    },
                ],
            })
        ).rejects.toThrow("You do not have permission to create or attach metrics during import");

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
                    target: { kind: "create", name: "Brand New Metric" },
                    entries: [{ memberId: member.id, value: 200 }],
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
                        target: { kind: "existing", metricId: setup2.attachedMetric.id },
                        entries: [{ memberId: setup2.member.id, value: 100 }],
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
                        target: { kind: "existing", metricId: setup1.attachedMetric.id },
                        entries: [{ memberId: setup2.member.id, value: 100 }], // member from setup2
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
                        target: { kind: "existing", metricId: setup2.attachedMetric.id }, // metric from setup2
                        entries: [{ memberId: setup1.member.id, value: 100 }],
                    },
                ],
            })
        ).rejects.toThrow("One or more metrics do not belong to this alliance");
    });

    it("import into Period A leaves Period B completely unchanged", async () => {
        const { alliance, member, periodA, periodB, attachedMetric } = await makeTestSetup();

        await importMemberMetrics({
            periodId: periodA.id,
            allianceId: alliance.id,
            mappings: [
                {
                    target: { kind: "existing", metricId: attachedMetric.id },
                    entries: [{ memberId: member.id, value: 500 }],
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
});
