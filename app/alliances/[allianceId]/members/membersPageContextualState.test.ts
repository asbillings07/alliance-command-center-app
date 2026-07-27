import { describe, it, expect } from "vitest";
import {
  isActiveMemberPrerequisiteEmptyState,
  resolveMembersContextualBanner,
} from "./membersPageContextualState";

describe("resolveMembersContextualBanner", () => {
  it("returns no-periods when zero periods overlap with an invalid deep link", () => {
    expect(
      resolveMembersContextualBanner({
        filter: "active",
        activeMemberCount: 2,
        totalPeriodCount: 0,
        requestedPeriodId: "missing-period",
        selectedPeriodId: undefined,
        periodMetricCount: 0,
        hasResultsInView: false,
      }),
    ).toEqual({ kind: "no-periods" });
  });

  it("returns no-periods when there are zero periods and no deep link", () => {
    expect(
      resolveMembersContextualBanner({
        filter: "active",
        activeMemberCount: 2,
        totalPeriodCount: 0,
        requestedPeriodId: undefined,
        selectedPeriodId: undefined,
        periodMetricCount: 0,
        hasResultsInView: false,
      }),
    ).toEqual({ kind: "no-periods" });
  });

  it("returns none during active-member prerequisite even with invalid periodId", () => {
    expect(
      resolveMembersContextualBanner({
        filter: "active",
        activeMemberCount: 0,
        totalPeriodCount: 0,
        requestedPeriodId: "missing-period",
        selectedPeriodId: undefined,
        periodMetricCount: 0,
        hasResultsInView: false,
      }),
    ).toEqual({ kind: "none" });
  });

  it("returns no-results when metrics exist but nothing is recorded in view", () => {
    expect(
      resolveMembersContextualBanner({
        filter: "active",
        activeMemberCount: 2,
        totalPeriodCount: 1,
        requestedPeriodId: "per_1",
        selectedPeriodId: "per_1",
        periodMetricCount: 1,
        hasResultsInView: false,
      }),
    ).toEqual({ kind: "no-results" });
  });
});

describe("isActiveMemberPrerequisiteEmptyState", () => {
  it("is true only for active filter with zero active members and empty list", () => {
    expect(isActiveMemberPrerequisiteEmptyState("active", 0, 0)).toBe(true);
    expect(isActiveMemberPrerequisiteEmptyState("all", 0, 1)).toBe(false);
  });
});
