"use server";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { prisma } from "@/app/src/lib/prisma";
import { touchAllianceSetupActivity } from "@/app/src/lib/touchAllianceSetupActivity";
import { revalidateAllianceData } from "@/app/src/lib/cache/revalidateAllianceData";
import {
  Metric_Type,
  MemberMetricEntryStatus,
  MetricObservationGrain,
} from "@/app/generated/prisma/enums";
import { isValidBooleanMetricValue } from "@/app/src/lib/metrics/booleanMetricValue";
import { revalidatePath } from "next/cache";

type RecordMemberMetricsInput = {
  periodId: string;
  metricId: string;
  allianceId: string;
  entries: {
    memberId: string;
    value: number;
  }[];
};

export async function recordMemberMetrics(
  input: RecordMemberMetricsInput,
): Promise<void> {
  const { periodId, metricId, allianceId, entries } = input;

  if (!periodId || !metricId || !allianceId) {
    throw new Error("Period, metric, and alliance are required");
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    throw new Error("At least one entry is required");
  }

  await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.IMPORT_METRICS,
  });

  // Query scoped by both id and allianceId for safety
  const period = await prisma.metricPeriod.findFirst({
    where: { id: periodId, allianceId },
  });

  if (!period) {
    throw new Error("Period not found");
  }

  // Validate metric is configured for this period, and load the authoritative
  // metric type (for BOOLEAN validation below) and observationGrain. ADR-018
  // §3: an entry's grain is always written from the metric's own grain at
  // insert time, never hardcoded or assumed - the grain-snapshot foreign key
  // rejects any mismatch, but this manual-recording form only ever presents a
  // single value per member, so every write here is PERIOD_VALUE today.
  const periodMetric = await prisma.metricPeriodMetric.findUnique({
    where: {
      periodId_metricId: { periodId, metricId },
    },
    include: { metric: { select: { type: true, observationGrain: true } } },
  });

  if (!periodMetric) {
    throw new Error("Metric is not configured for this period");
  }

  // This manual-recording form collects one value per member with no way to
  // capture an observation date, so a DAILY_OBSERVATION metric would
  // otherwise deterministically fail the grain/observedOn CHECK constraint
  // below with a much less useful DB-level message. Reject it here instead,
  // before any validation or write - remove this guard once a later slice
  // adds a daily-entry UI (#287 database design §8).
  if (periodMetric.metric.observationGrain === MetricObservationGrain.DAILY_OBSERVATION) {
    throw new Error(
      "This metric records daily observations and cannot be recorded here yet - this form has no way to collect the observation date",
    );
  }

  // Validate all entries have integer values; BOOLEAN metrics additionally
  // require exactly 0 or 1 (#190) so the value can never be misinterpreted as
  // a true/false rate downstream.
  for (const entry of entries) {
    if (typeof entry.value !== "number" || !Number.isInteger(entry.value)) {
      throw new Error("All values must be integers");
    }
    if (
      periodMetric.metric.type === Metric_Type.BOOLEAN &&
      !isValidBooleanMetricValue(entry.value)
    ) {
      throw new Error("Boolean metric values must be exactly 0 or 1");
    }
    if (typeof entry.memberId !== "string" || !entry.memberId) {
      throw new Error("Invalid member ID");
    }
  }

  // Validate all allianceMemberIds belong to this alliance
  const allianceMemberIds = entries.map((e) => e.memberId);
  const validAllianceMembers = await prisma.allianceMember.findMany({
    where: {
      id: { in: allianceMemberIds },
      allianceId: allianceId,
    },
    select: { id: true },
  });

  const validAllianceMemberIds = new Set(validAllianceMembers.map((m) => m.id));
  const invalidAllianceMemberIds = allianceMemberIds.filter((id) => !validAllianceMemberIds.has(id));

  if (invalidAllianceMemberIds.length > 0) {
    throw new Error("One or more members do not belong to this alliance");
  }

  await prisma.$transaction(async (tx) => {
    await tx.memberMetricEntry.createMany({
      data: entries.map((entry) => ({
        allianceMemberId: entry.memberId,
        periodId,
        metricId,
        value: entry.value,
        observationGrain: periodMetric.metric.observationGrain,
        status: MemberMetricEntryStatus.ACTIVE,
      })),
    });
    await touchAllianceSetupActivity(tx, allianceId);
  });

  revalidatePath(`/alliances/${period.allianceId}/periods/${period.id}/record`);
  revalidateAllianceData({
    allianceId,
    periodId,
    // ADR-018: every observation-changing write invalidates the same five
    // domains as import (members/dashboard read entry-derived setup
    // completion and roster values, not just the period/report views).
    // "setup" matches the touchAllianceSetupActivity call above — without it
    // the setup checklist can show a stale setupActivityAt after recording.
    domains: ["members", "dashboard", "setup", "evaluation-results", "reports"],
  });
}
