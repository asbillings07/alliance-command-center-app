"use server";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions, hasPermission } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import {
  buildMetricImportPlan,
  validateColumnTargets,
  type ColumnTargetMapping,
  type MetricMapping,
} from "@/app/src/lib/metricImport";
import {
  classifyTargets,
  deriveRequiredPermissions,
  findDuplicateResolvedMetricId,
  resolveMetricTargets,
} from "@/app/src/lib/metricResolution";
import { revalidatePath } from "next/cache";

type ImportMetricsInput = {
  periodId: string;
  allianceId: string;
  mappings: ColumnTargetMapping[];
};

type MetricSummary = { metricId: string; name: string };

type ImportMetricsResult = {
  success: boolean;
  totalCount: number;
  perMetric: (MetricSummary & { count: number })[];
  created: MetricSummary[];
  attached: MetricSummary[];
};

export async function importMemberMetrics(
  input: ImportMetricsInput,
): Promise<ImportMetricsResult> {
  const { periodId, allianceId, mappings } = input;

  if (!periodId || !allianceId) {
    throw new Error("Period and alliance are required");
  }

  // Validate + normalize column mappings (integer values, per-member dedupe,
  // no duplicate targets) before any DB work. Throws on the first violation.
  const validated = validateColumnTargets(mappings);

  // Base gate: everyone importing needs IMPORT_METRICS. Additional capability
  // requirements are derived from how the targets resolve, below.
  const auth = await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.IMPORT_METRICS,
  });

  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
    select: { id: true },
  });
  if (!period) {
    throw new Error("Period not found");
  }

  // Load the alliance's metric library and this period's attachments so the
  // server (not the client) decides how each target resolves.
  const [libraryMetrics, periodMetrics] = await Promise.all([
    prisma.metric.findMany({
      where: { allianceId, active: true },
      select: { id: true, name: true },
      // Deterministic order so classifyTargets' first-seen tie-breaking for
      // names that differ only by case/whitespace is stable and matches the UI.
      orderBy: { name: "asc" },
    }),
    prisma.metricPeriodMetric.findMany({
      // Only active links count as "already on the period". An inactive link
      // must reclassify to "attach" so resolution reactivates it instead of
      // silently importing entries into a hidden metric.
      where: { periodId: period.id, active: true },
      select: { metricId: true },
    }),
  ]);

  const libraryMetricIds = new Set(libraryMetrics.map((m) => m.id));
  const attachedMetricIds = new Set(periodMetrics.map((pm) => pm.metricId));
  // Any "existing" target must reference a metric owned by this alliance: either
  // one in the active library, or one already attached to this (alliance-scoped)
  // period. The latter covers metrics that were archived without being detached
  // - they still legitimately belong here and are offered by the import UI.
  for (const { target } of validated) {
    if (
      target.kind === "existing" &&
      !libraryMetricIds.has(target.metricId) &&
      !attachedMetricIds.has(target.metricId)
    ) {
      throw new Error("One or more metrics do not belong to this alliance");
    }
  }

  const classified = classifyTargets({
    targets: validated.map((m) => m.target),
    periodMetricIds: periodMetrics.map((pm) => pm.metricId),
    libraryMetrics,
  });

  // validateColumnTargets dedupes raw inputs, but classification can collapse a
  // "create" onto an existing library metric (name match), which may now collide
  // with another column that already targets that metric. Detect it here with a
  // clear message instead of failing late inside the transaction via
  // buildMetricImportPlan (after avoidable resolution work).
  if (findDuplicateResolvedMetricId(classified)) {
    throw new Error("Each metric may only be mapped once");
  }

  // Enforce least-privilege: attaching needs CONFIGURE_PERIODS, creating a new
  // metric needs CONFIGURE_METRICS. This preserves the boundary where a LEADER
  // can import and attach but cannot invent new metrics.
  for (const permission of deriveRequiredPermissions(classified)) {
    if (!hasPermission(auth.permissions, permission)) {
      throw new Error(
        "You do not have permission to create or attach metrics during import",
      );
    }
  }

  // Validate every referenced member belongs to this alliance.
  const memberIds = [
    ...new Set(validated.flatMap((m) => m.entries.map((e) => e.memberId))),
  ];
  const validMembers = await prisma.allianceMember.findMany({
    where: { id: { in: memberIds }, allianceId },
    select: { id: true },
  });
  const validMemberIds = new Set(validMembers.map((m) => m.id));
  if (memberIds.some((id) => !validMemberIds.has(id))) {
    throw new Error("One or more members do not belong to this alliance");
  }

  // Resolve configuration and write entries atomically: create/attach any
  // missing metrics, then import. A failure anywhere rolls back everything -
  // no dangling metrics, no partial import.
  const { plan, resolved } = await prisma.$transaction(async (tx) => {
    const resolved = await resolveMetricTargets(tx, {
      allianceId,
      periodId,
      classified,
    });

    // Zip resolved metric ids back onto their entries; buildMetricImportPlan
    // also guards against two columns collapsing onto the same metric.
    const finalMappings: MetricMapping[] = resolved.map((r, i) => ({
      metricId: r.metricId,
      entries: validated[i].entries,
    }));
    const plan = buildMetricImportPlan(finalMappings);

    for (const mapping of plan.mappings) {
      await tx.memberMetricEntry.createMany({
        data: mapping.entries.map((entry) => ({
          allianceMemberId: entry.memberId,
          periodId,
          metricId: mapping.metricId,
          value: entry.value,
        })),
      });
    }

    return { plan, resolved };
  });

  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/import`);
  revalidatePath(`/alliances/${allianceId}/periods/${periodId}/record`);

  // Resolve metric names for the UI from the persisted rows, not the active
  // library snapshot: this covers metrics that were just created or that are
  // archived-but-attached (absent from the active library), which would
  // otherwise fall back to a "Metric" placeholder.
  const summaryMetricIds = [...new Set(resolved.map((r) => r.metricId))];
  const summaryMetrics = await prisma.metric.findMany({
    where: { id: { in: summaryMetricIds } },
    select: { id: true, name: true },
  });
  const nameById = new Map(summaryMetrics.map((m) => [m.id, m.name]));
  const nameFor = (metricId: string) => nameById.get(metricId) ?? "Metric";

  const dedupeSummaries = (metricIds: string[]): MetricSummary[] =>
    [...new Set(metricIds)].map((metricId) => ({
      metricId,
      name: nameFor(metricId),
    }));

  return {
    success: true,
    totalCount: plan.totalCount,
    perMetric: plan.mappings.map((m) => ({
      metricId: m.metricId,
      name: nameFor(m.metricId),
      count: m.entries.length,
    })),
    created: dedupeSummaries(resolved.filter((r) => r.created).map((r) => r.metricId)),
    attached: dedupeSummaries(resolved.filter((r) => r.attached).map((r) => r.metricId)),
  };
}
