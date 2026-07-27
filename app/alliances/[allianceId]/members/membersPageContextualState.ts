export type MembersContextualBannerState =
  | { kind: "none" }
  | { kind: "invalid-period" }
  | { kind: "no-periods" }
  | { kind: "no-metrics" }
  | { kind: "no-results" };

type ResolveMembersContextualBannerInput = {
  filter: "active" | "archived" | "all";
  activeMemberCount: number;
  totalPeriodCount: number;
  requestedPeriodId?: string;
  selectedPeriodId?: string;
  periodMetricCount: number;
  hasResultsInView: boolean;
};

/**
 * Picks exactly one contextual banner for the members list, following precedence:
 * 1. Active-member prerequisite is handled separately (empty state, not a banner).
 * 2. Invalid period deep link
 * 3. No evaluation periods exist
 * 4. Selected period has no configured metrics
 * 5. Selected period has metrics but none recorded for members in this view
 */
export function resolveMembersContextualBanner(
  input: ResolveMembersContextualBannerInput,
): MembersContextualBannerState {
  const {
    filter,
    activeMemberCount,
    totalPeriodCount,
    requestedPeriodId,
    selectedPeriodId,
    periodMetricCount,
    hasResultsInView,
  } = input;

  const showingActiveMemberPrerequisite = filter === "active" && activeMemberCount === 0;
  if (showingActiveMemberPrerequisite) {
    return { kind: "none" };
  }

  if (requestedPeriodId && !selectedPeriodId) {
    return { kind: "invalid-period" };
  }

  if (totalPeriodCount === 0 && !selectedPeriodId) {
    return { kind: "no-periods" };
  }

  if (selectedPeriodId && periodMetricCount === 0) {
    return { kind: "no-metrics" };
  }

  if (selectedPeriodId && periodMetricCount > 0 && !hasResultsInView) {
    return { kind: "no-results" };
  }

  return { kind: "none" };
}

export function isActiveMemberPrerequisiteEmptyState(
  filter: "active" | "archived" | "all",
  activeMemberCount: number,
  visibleMemberCount: number,
): boolean {
  return filter === "active" && activeMemberCount === 0 && visibleMemberCount === 0;
}
