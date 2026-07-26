/**
 * Pure orchestration for multi-period metric import.
 *
 * Groups client submissions by target period and reuses the existing
 * single-period validation/classification helpers once per group so
 * (period, metric) uniqueness holds without modifying metricImport.ts.
 */

import {
  validateColumnTargets,
  type ColumnTargetMapping,
  type ValidatedColumnTargetMapping,
} from "@/app/src/lib/metricImport";
import {
  classifyTargets,
  deriveRequiredPermissions,
  findDuplicateResolvedMetricId,
  type ClassifiedTarget,
} from "@/app/src/lib/metricResolution";
import { Permissions, type Permission } from "@/app/src/lib/auth/permissions";
import {
  normalizeMetricPeriodName,
  validateMetricPeriodFields,
} from "@/app/src/lib/metricPeriodValidation";

export type MultiPeriodGroupTarget =
  | { kind: "existing"; periodId: string }
  | { kind: "create"; name: string; startsAt: string | null; endsAt: string | null };

export type MultiPeriodImportGroupInput = {
  target: MultiPeriodGroupTarget;
  mappings: ColumnTargetMapping[];
};

export type MultiPeriodImportGroupPlan = {
  groupKey: string;
  target: MultiPeriodGroupTarget;
  validated: ValidatedColumnTargetMapping[];
  classified: ClassifiedTarget[];
  requiredPermissions: Permission[];
};

export function groupKeyForTarget(target: MultiPeriodGroupTarget): string {
  if (target.kind === "existing") {
    return `existing:${target.periodId}`;
  }
  const validated = validateMetricPeriodFields(target);
  return `create:${normalizeMetricPeriodName(validated.name)}:${target.startsAt ?? ""}:${target.endsAt ?? ""}`;
}

export function validateMultiPeriodImportGroups(
  groups: MultiPeriodImportGroupInput[],
): void {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error("At least one period group is required");
  }

  const seenExistingPeriodIds = new Set<string>();
  const seenCreateNames = new Set<string>();

  for (const group of groups) {
    if (!group.target || typeof group.target !== "object") {
      throw new Error("Each group requires a target period");
    }

    if (group.target.kind === "existing") {
      if (typeof group.target.periodId !== "string" || !group.target.periodId) {
        throw new Error("Each group requires a target period");
      }

      // Leaders must combine proposals targeting the same period in the UI;
      // do not silently merge duplicate target periods server-side.
      if (seenExistingPeriodIds.has(group.target.periodId)) {
        throw new Error(
          "Each target period may only appear once; combine columns for the same period in the mapping UI",
        );
      }
      seenExistingPeriodIds.add(group.target.periodId);
    } else if (group.target.kind === "create") {
      validateMetricPeriodFields(group.target);

      const normalizedName = normalizeMetricPeriodName(group.target.name);
      // No DB uniqueness on (allianceId, name) exists today; reject duplicate
      // create targets in one submission so leaders merge proposals or map to existing.
      if (seenCreateNames.has(normalizedName)) {
        throw new Error(
          "Each new period name may only appear once in this import; map the second group to an existing period or merge proposals in the mapping UI",
        );
      }
      seenCreateNames.add(normalizedName);
    } else {
      throw new Error("Each group requires a target period");
    }

    if (!Array.isArray(group.mappings) || group.mappings.length === 0) {
      throw new Error("Each period group requires at least one column mapping");
    }
  }
}

export function planMultiPeriodImportGroup(
  group: MultiPeriodImportGroupInput,
  context: {
    periodMetricIds: string[];
    libraryMetrics: { id: string; name: string }[];
  },
): MultiPeriodImportGroupPlan {
  const validated = validateColumnTargets(group.mappings);
  const classified = classifyTargets({
    targets: validated.map((m) => m.target),
    periodMetricIds: context.periodMetricIds,
    libraryMetrics: context.libraryMetrics,
  });

  if (findDuplicateResolvedMetricId(classified)) {
    throw new Error("Each metric may only be mapped once per period");
  }

  return {
    groupKey: groupKeyForTarget(group.target),
    target: group.target,
    validated,
    classified,
    requiredPermissions: deriveRequiredPermissions(classified),
  };
}

export function aggregateRequiredPermissions(
  groupPlans: MultiPeriodImportGroupPlan[],
  groups: MultiPeriodImportGroupInput[],
): Permission[] {
  const required = new Set<Permission>();
  for (const plan of groupPlans) {
    for (const permission of plan.requiredPermissions) {
      required.add(permission);
    }
  }
  if (groups.some((group) => group.target.kind === "create")) {
    required.add(Permissions.CONFIGURE_PERIODS);
  }
  return [...required];
}
