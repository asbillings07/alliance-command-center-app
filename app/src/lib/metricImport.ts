/**
 * Pure planning logic for importing member metrics from a spreadsheet.
 *
 * This module is deliberately free of Prisma, Next.js, and request context so
 * the interesting invariants (integer values, per-metric dedupe, no duplicate
 * metric columns) can be unit-tested in isolation. The server action layers
 * authorization and persistence on top of the plan this produces.
 */

import { normalizeName } from "@/app/src/lib/memberMatcher";
import type { ImportMetricTarget } from "@/app/src/lib/metricResolution";

export type MetricImportEntry = {
  /** allianceMemberId */
  memberId: string;
  value: number;
};

/** A spreadsheet column's chosen import target plus its parsed rows. */
export type ColumnTargetMapping = {
  target: ImportMetricTarget;
  entries: MetricImportEntry[];
};

/** One spreadsheet column mapped to one period metric. */
export type MetricMapping = {
  metricId: string;
  entries: MetricImportEntry[];
};

export type MetricImportPlan = {
  mappings: MetricMapping[];
  /** Distinct metric ids across the plan, for period-configuration checks. */
  metricIds: string[];
  /** Distinct member ids across the plan, for alliance-membership checks. */
  memberIds: string[];
  /** Total rows that will be written once the plan is persisted. */
  totalCount: number;
};

/**
 * Validate and normalize a set of column->metric mappings into an import plan.
 *
 * Throws on the first invariant violation so the caller never persists a
 * partially-valid import. Within each metric, only the first row per member is
 * kept (mirroring the single-metric UI, where the user resolves duplicates to a
 * single value); the same member may legitimately appear under different
 * metrics.
 */
export function buildMetricImportPlan(
  mappings: MetricMapping[],
): MetricImportPlan {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new Error("At least one metric mapping is required");
  }

  const seenMetricIds = new Set<string>();
  const metricIds: string[] = [];
  const memberIds = new Set<string>();
  const plannedMappings: MetricMapping[] = [];
  let totalCount = 0;

  for (const mapping of mappings) {
    const { metricId, entries } = mapping;

    if (typeof metricId !== "string" || !metricId) {
      throw new Error("Invalid metric ID");
    }
    if (seenMetricIds.has(metricId)) {
      throw new Error("Each metric may only be mapped once");
    }
    seenMetricIds.add(metricId);

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("Each metric mapping requires at least one entry");
    }

    // Keep the first row per member for this metric.
    const seenMemberIds = new Set<string>();
    const dedupedEntries: MetricImportEntry[] = [];

    for (const entry of entries) {
      if (typeof entry.memberId !== "string" || !entry.memberId) {
        throw new Error("Invalid member ID");
      }
      if (typeof entry.value !== "number" || !Number.isInteger(entry.value)) {
        throw new Error("All values must be integers");
      }

      if (seenMemberIds.has(entry.memberId)) {
        continue;
      }
      seenMemberIds.add(entry.memberId);
      memberIds.add(entry.memberId);
      dedupedEntries.push({ memberId: entry.memberId, value: entry.value });
    }

    metricIds.push(metricId);
    plannedMappings.push({ metricId, entries: dedupedEntries });
    totalCount += dedupedEntries.length;
  }

  return {
    mappings: plannedMappings,
    metricIds,
    memberIds: [...memberIds],
    totalCount,
  };
}

/**
 * Validate the raw column mappings a client submits, before any metric identity
 * is resolved. Rejects mapping the same existing metric or the same new-metric
 * name to two columns, enforces integer values, and dedupes rows per member
 * within each column (mirroring the single-column UI). Returns normalized
 * mappings with deduped entries; the target is passed through untouched for the
 * resolution step to reconcile against the database.
 */
export function validateColumnTargets(
  mappings: ColumnTargetMapping[],
): ColumnTargetMapping[] {
  if (!Array.isArray(mappings) || mappings.length === 0) {
    throw new Error("At least one column mapping is required");
  }

  const seenExistingMetricIds = new Set<string>();
  const seenCreateNames = new Set<string>();
  const result: ColumnTargetMapping[] = [];

  for (const mapping of mappings) {
    const { target, entries } = mapping;

    if (target.kind === "existing") {
      if (typeof target.metricId !== "string" || !target.metricId) {
        throw new Error("Invalid metric ID");
      }
      if (seenExistingMetricIds.has(target.metricId)) {
        throw new Error("Each metric may only be mapped once");
      }
      seenExistingMetricIds.add(target.metricId);
    } else {
      const name = (target.name ?? "").trim();
      if (!name) {
        throw new Error("A new metric requires a name");
      }
      const normalized = normalizeName(name);
      if (seenCreateNames.has(normalized)) {
        throw new Error("Each new metric may only be mapped once");
      }
      seenCreateNames.add(normalized);
    }

    if (!Array.isArray(entries) || entries.length === 0) {
      throw new Error("Each mapping requires at least one entry");
    }

    const seenMemberIds = new Set<string>();
    const dedupedEntries: MetricImportEntry[] = [];
    for (const entry of entries) {
      if (typeof entry.memberId !== "string" || !entry.memberId) {
        throw new Error("Invalid member ID");
      }
      if (typeof entry.value !== "number" || !Number.isInteger(entry.value)) {
        throw new Error("All values must be integers");
      }
      if (seenMemberIds.has(entry.memberId)) {
        continue;
      }
      seenMemberIds.add(entry.memberId);
      dedupedEntries.push({ memberId: entry.memberId, value: entry.value });
    }

    result.push({ target, entries: dedupedEntries });
  }

  return result;
}
