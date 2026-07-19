/**
 * Import-driven configuration resolution.
 *
 * Turns the metric targets a client *intends* (ImportMetricTarget) into the
 * concrete metric identities the server *commits to* (ResolvedMetricTarget),
 * reconciling them against the alliance's current configuration. Creating a
 * metric is only one of several outcomes; the point is to reuse existing
 * configuration wherever possible and never invent configuration the caller
 * isn't authorized for.
 *
 * The decision layer (classifyTargets, deriveRequiredPermissions) is pure and
 * unit-tested; resolveMetricTargets performs the reconciling writes inside a
 * caller-supplied transaction.
 */
import type { Prisma } from "@/app/generated/prisma/client";
import { Metric_Type } from "@/app/generated/prisma/enums";
import { Permissions, type Permission } from "@/app/src/lib/auth/permissions";
import { normalizeName } from "@/app/src/lib/memberMatcher";

// What the client asks for. "existing" references a metric by id; "create"
// asks for a metric by name (which the server may find already exists).
export type ImportMetricTarget =
  | { kind: "existing"; metricId: string }
  | { kind: "create"; name: string };

// Server reality: how a target resolves once reconciled with the database.
//   existing -> metric is already attached to the period; import only.
//   attach   -> metric exists in the library but is not on the period yet.
//   create   -> no such metric exists; a new one must be created.
export type TargetDisposition = "existing" | "attach" | "create";

export type ClassifiedTarget = {
    disposition: TargetDisposition;
    // Present for existing/attach (the known metric); null for create.
    metricId: string | null;
    // Present for create (the new metric's name); null otherwise.
    createName: string | null;
};

// The identity the server commits to after resolution.
export type ResolvedMetricTarget = {
    metricId: string;
    created: boolean;
    attached: boolean;
};

type LibraryMetric = { id: string; name: string };

/**
 * Reconcile client intent against server reality. Never trusts the client's
 * own classification: a "create" whose name already matches a library metric
 * is downgraded to reuse that metric (existing or attach), preventing duplicate
 * configuration and unique-constraint violations.
 */
export function classifyTargets(params: {
    targets: ImportMetricTarget[];
    periodMetricIds: string[];
    libraryMetrics: LibraryMetric[];
}): ClassifiedTarget[] {
    const { targets, periodMetricIds, libraryMetrics } = params;
    const attachedIds = new Set(periodMetricIds);
    const libraryByName = new Map<string, LibraryMetric>();
    for (const metric of libraryMetrics) {
        libraryByName.set(normalizeName(metric.name), metric);
    }

    return targets.map((target) => {
        if (target.kind === "existing") {
            return {
                disposition: attachedIds.has(target.metricId) ? "existing" : "attach",
                metricId: target.metricId,
                createName: null,
            };
        }

        // create intent: reuse an existing library metric if the name matches.
        const existing = libraryByName.get(normalizeName(target.name));
        if (existing) {
            return {
                disposition: attachedIds.has(existing.id) ? "existing" : "attach",
                metricId: existing.id,
                createName: null,
            };
        }

        return { disposition: "create", metricId: null, createName: target.name };
    });
}

/**
 * Derive the least-privilege set of permissions an import actually requires,
 * given how its targets resolve. Import is always required; attaching a metric
 * to the period additionally requires CONFIGURE_PERIODS; creating a brand-new
 * metric additionally requires CONFIGURE_METRICS.
 */
export function deriveRequiredPermissions(
    classified: ClassifiedTarget[],
): Permission[] {
    const required: Permission[] = [Permissions.IMPORT_METRICS];
    const needsAttach = classified.some(
        (c) => c.disposition === "attach" || c.disposition === "create",
    );
    const needsCreate = classified.some((c) => c.disposition === "create");
    if (needsAttach) required.push(Permissions.CONFIGURE_PERIODS);
    if (needsCreate) required.push(Permissions.CONFIGURE_METRICS);
    return required;
}

/**
 * Execute the reconciliation inside a transaction: create missing metrics
 * (ensure-by-name to survive races/stale UI), attach anything not yet on the
 * period with scoring-neutral defaults (weight 0, not required), and report
 * what happened per target. Assumes classification and authorization have
 * already been validated by the caller.
 */
export async function resolveMetricTargets(
    tx: Prisma.TransactionClient,
    params: {
        allianceId: string;
        periodId: string;
        classified: ClassifiedTarget[];
    },
): Promise<ResolvedMetricTarget[]> {
    const { allianceId, periodId, classified } = params;
    const resolved: ResolvedMetricTarget[] = [];
    // Attach each metric at most once even if it appears in several targets.
    const attachedThisRun = new Set<string>();

    for (const item of classified) {
        let metricId = item.metricId;
        let created = false;

        if (item.disposition === "create") {
            const name = (item.createName ?? "").trim();
            // Ensure-by-name: another actor may have created it already.
            const existing = await tx.metric.findUnique({
                where: { allianceId_name: { allianceId, name } },
                select: { id: true },
            });
            if (existing) {
                metricId = existing.id;
            } else {
                const metric = await tx.metric.create({
                    data: { allianceId, name, type: Metric_Type.NUMERIC },
                    select: { id: true },
                });
                metricId = metric.id;
                created = true;
            }
        }

        if (!metricId) {
            throw new Error("Could not resolve metric target");
        }

        let attached = false;
        if (item.disposition !== "existing" && !attachedThisRun.has(metricId)) {
            // Idempotent attach: skip if it is somehow already on the period.
            const link = await tx.metricPeriodMetric.findUnique({
                where: { periodId_metricId: { periodId, metricId } },
                select: { periodId: true },
            });
            if (!link) {
                await tx.metricPeriodMetric.create({
                    data: { periodId, metricId, weight: 0, required: false },
                });
                attached = true;
            }
            attachedThisRun.add(metricId);
        }

        resolved.push({ metricId, created, attached });
    }

    return resolved;
}
