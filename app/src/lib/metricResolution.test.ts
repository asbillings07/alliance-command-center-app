import { describe, it, expect, vi } from "vitest";
import {
    classifyTargets,
    deriveRequiredPermissions,
    resolveMetricTargets,
    type ClassifiedTarget,
    type ImportMetricTarget,
} from "./metricResolution";
import { Permissions } from "@/app/src/lib/auth/permissions";
import type { Prisma } from "@/app/generated/prisma/client";

/**
 * Minimal fake transaction client for resolveMetricTargets. Records the upsert
 * calls so tests can assert we never fall back to create (which would risk a
 * P2002 abort) and that links are reactivated rather than skipped.
 */
function makeTx(options: {
    metricByName?: Record<string, { id: string }>;
    linkActiveByMetricId?: Record<string, boolean>;
}) {
    const metricUpsert = vi.fn(async ({ create }: { create: { name: string } }) => ({
        id: options.metricByName?.[create.name]?.id ?? `new-${create.name}`,
    }));
    const linkUpsert = vi.fn(async () => ({}));

    const tx = {
        metric: {
            findUnique: vi.fn(async ({ where }: { where: { allianceId_name: { name: string } } }) => {
                const found = options.metricByName?.[where.allianceId_name.name];
                return found ? { id: found.id } : null;
            }),
            upsert: metricUpsert,
        },
        metricPeriodMetric: {
            findUnique: vi.fn(async ({ where }: { where: { periodId_metricId: { metricId: string } } }) => {
                const active = options.linkActiveByMetricId?.[where.periodId_metricId.metricId];
                return active === undefined ? null : { active };
            }),
            upsert: linkUpsert,
        },
    };

    return { tx: tx as unknown as Prisma.TransactionClient, metricUpsert, linkUpsert };
}

const library = [
    { id: "m-kp", name: "Kill Points" },
    { id: "m-vs", name: "VS Score" },
];

describe("classifyTargets", () => {
    it("classifies an existing metric already on the period as 'existing'", () => {
        const targets: ImportMetricTarget[] = [{ kind: "existing", metricId: "m-kp" }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "existing", metricId: "m-kp", createName: null });
    });

    it("classifies a library metric not on the period as 'attach'", () => {
        const targets: ImportMetricTarget[] = [{ kind: "existing", metricId: "m-vs" }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "attach", metricId: "m-vs", createName: null });
    });

    it("classifies a create for a truly new name as 'create'", () => {
        const targets: ImportMetricTarget[] = [{ kind: "create", name: "Donations" }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "create", metricId: null, createName: "Donations" });
    });

    it("reclassifies a create whose name matches a library metric (not trusting the client)", () => {
        // Client thinks it's creating, but the metric already exists in the
        // library and just is not on this period -> attach, not create.
        const targets: ImportMetricTarget[] = [{ kind: "create", name: "  vs   score " }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "attach", metricId: "m-vs", createName: null });
    });

    it("reclassifies a create to 'existing' when the matched metric is already on the period", () => {
        const targets: ImportMetricTarget[] = [{ kind: "create", name: "Kill Points" }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: ["m-kp"],
            libraryMetrics: library,
        });
        expect(result).toEqual({ disposition: "existing", metricId: "m-kp", createName: null });
    });

    it("keeps the first library metric for names that differ only by case/whitespace", () => {
        // Two library metrics collide on their normalized name. Resolution must
        // deterministically pick the first (input is ordered), never the later one.
        const collidingLibrary = [
            { id: "m-first", name: "Kill Points" },
            { id: "m-second", name: "  kill   points " },
        ];
        const targets: ImportMetricTarget[] = [{ kind: "create", name: "KILL POINTS" }];
        const [result] = classifyTargets({
            targets,
            periodMetricIds: [],
            libraryMetrics: collidingLibrary,
        });
        expect(result).toEqual({ disposition: "attach", metricId: "m-first", createName: null });
    });
});

describe("deriveRequiredPermissions", () => {
    it("requires only IMPORT_METRICS when everything is already attached", () => {
        const perms = deriveRequiredPermissions([
            { disposition: "existing", metricId: "m-kp", createName: null },
        ]);
        expect(perms).toEqual([Permissions.IMPORT_METRICS]);
    });

    it("adds CONFIGURE_PERIODS when a metric must be attached", () => {
        const perms = deriveRequiredPermissions([
            { disposition: "existing", metricId: "m-kp", createName: null },
            { disposition: "attach", metricId: "m-vs", createName: null },
        ]);
        expect(perms).toEqual([Permissions.IMPORT_METRICS, Permissions.CONFIGURE_PERIODS]);
    });

    it("adds CONFIGURE_PERIODS and CONFIGURE_METRICS when a metric must be created", () => {
        const perms = deriveRequiredPermissions([
            { disposition: "create", metricId: null, createName: "Donations" },
        ]);
        expect(perms).toEqual([
            Permissions.IMPORT_METRICS,
            Permissions.CONFIGURE_PERIODS,
            Permissions.CONFIGURE_METRICS,
        ]);
    });
});

describe("resolveMetricTargets", () => {
    it("creates a brand-new metric via upsert (race-safe) and attaches it", async () => {
        const { tx, metricUpsert, linkUpsert } = makeTx({});
        const classified: ClassifiedTarget[] = [
            { disposition: "create", metricId: null, createName: "Donations" },
        ];

        const [resolved] = await resolveMetricTargets(tx, {
            allianceId: "a1",
            periodId: "p1",
            classified,
        });

        expect(metricUpsert).toHaveBeenCalledOnce();
        expect(resolved).toEqual({ metricId: "new-Donations", created: true, attached: true });
        // The new attachment defaults to active and scoring-neutral.
        expect(linkUpsert).toHaveBeenCalledWith(
            expect.objectContaining({
                create: { periodId: "p1", metricId: "new-Donations", weight: 0, required: false, active: true },
                update: { active: true },
            }),
        );
    });

    it("reports created=false when a create-intent metric already exists (converges via upsert)", async () => {
        const { tx } = makeTx({ metricByName: { Donations: { id: "m-don" } } });
        const classified: ClassifiedTarget[] = [
            { disposition: "create", metricId: null, createName: "Donations" },
        ];

        const [resolved] = await resolveMetricTargets(tx, {
            allianceId: "a1",
            periodId: "p1",
            classified,
        });

        expect(resolved.created).toBe(false);
        expect(resolved.metricId).toBe("m-don");
    });

    it("reactivates an archived metric matched by name during create (no hidden import)", async () => {
        // create-intent matches an archived metric (not in the active library).
        // The upsert must flip the metric back to active, not import into it hidden.
        const { tx, metricUpsert } = makeTx({ metricByName: { Donations: { id: "m-arch" } } });
        const classified: ClassifiedTarget[] = [
            { disposition: "create", metricId: null, createName: "Donations" },
        ];

        await resolveMetricTargets(tx, { allianceId: "a1", periodId: "p1", classified });

        expect(metricUpsert).toHaveBeenCalledWith(
            expect.objectContaining({ update: { active: true } }),
        );
    });

    it("reactivates an inactive period link instead of leaving the metric hidden", async () => {
        const { tx, linkUpsert } = makeTx({ linkActiveByMetricId: { "m-vs": false } });
        const classified: ClassifiedTarget[] = [
            { disposition: "attach", metricId: "m-vs", createName: null },
        ];

        const [resolved] = await resolveMetricTargets(tx, {
            allianceId: "a1",
            periodId: "p1",
            classified,
        });

        // Resurrected from inactive -> reported as (re)attached, link flipped active.
        expect(resolved).toEqual({ metricId: "m-vs", created: false, attached: true });
        expect(linkUpsert).toHaveBeenCalledWith(
            expect.objectContaining({ update: { active: true } }),
        );
    });

    it("treats an already-active link as a no-op attach", async () => {
        const { tx } = makeTx({ linkActiveByMetricId: { "m-vs": true } });
        const classified: ClassifiedTarget[] = [
            { disposition: "attach", metricId: "m-vs", createName: null },
        ];

        const [resolved] = await resolveMetricTargets(tx, {
            allianceId: "a1",
            periodId: "p1",
            classified,
        });

        expect(resolved.attached).toBe(false);
    });

    it("attaches a metric at most once when it appears in several targets", async () => {
        const { tx, linkUpsert } = makeTx({});
        const classified: ClassifiedTarget[] = [
            { disposition: "attach", metricId: "m-vs", createName: null },
            { disposition: "attach", metricId: "m-vs", createName: null },
        ];

        await resolveMetricTargets(tx, { allianceId: "a1", periodId: "p1", classified });

        expect(linkUpsert).toHaveBeenCalledOnce();
    });
});
