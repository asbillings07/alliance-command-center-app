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
import type { Permission } from "@/app/src/lib/auth/permissions";

export type MultiPeriodImportGroupInput = {
  targetPeriodId: string;
  mappings: ColumnTargetMapping[];
};

export type MultiPeriodImportGroupPlan = {
  targetPeriodId: string;
  validated: ValidatedColumnTargetMapping[];
  classified: ClassifiedTarget[];
  requiredPermissions: Permission[];
};

export function validateMultiPeriodImportGroups(
  groups: MultiPeriodImportGroupInput[],
): void {
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error("At least one period group is required");
  }

  const seenPeriodIds = new Set<string>();
  for (const group of groups) {
    if (typeof group.targetPeriodId !== "string" || !group.targetPeriodId) {
      throw new Error("Each group requires a target period");
    }

    // Leaders must combine proposals targeting the same period in the UI;
    // do not silently merge duplicate target periods server-side.
    if (seenPeriodIds.has(group.targetPeriodId)) {
      throw new Error(
        "Each target period may only appear once; combine columns for the same period in the mapping UI",
      );
    }
    seenPeriodIds.add(group.targetPeriodId);

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
    targetPeriodId: group.targetPeriodId,
    validated,
    classified,
    requiredPermissions: deriveRequiredPermissions(classified),
  };
}

export function aggregateRequiredPermissions(
  groupPlans: MultiPeriodImportGroupPlan[],
): Permission[] {
  const required = new Set<Permission>();
  for (const plan of groupPlans) {
    for (const permission of plan.requiredPermissions) {
      required.add(permission);
    }
  }
  return [...required];
}
