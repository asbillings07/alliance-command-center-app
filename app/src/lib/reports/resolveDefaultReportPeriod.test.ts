import { describe, it, expect } from "vitest";
import {
  pickDefaultReportPeriod,
  type DefaultReportPeriodCandidate,
} from "./resolveDefaultReportPeriod";

function candidate(
  overrides: Partial<DefaultReportPeriodCandidate>,
): DefaultReportPeriodCandidate {
  return {
    id: "period-1",
    name: "Period 1",
    startsAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2026-01-01T00:00:00Z"),
    periodActive: true,
    attachmentActive: true,
    ...overrides,
  };
}

describe("pickDefaultReportPeriod", () => {
  it("returns null when the metric has never been attached to any period", () => {
    expect(pickDefaultReportPeriod([])).toBeNull();
  });

  it("prefers the latest ACTIVE period with an ACTIVE attachment", () => {
    const older = candidate({
      id: "older",
      name: "Older",
      startsAt: new Date("2026-01-01T00:00:00Z"),
    });
    const newer = candidate({
      id: "newer",
      name: "Newer",
      startsAt: new Date("2026-03-01T00:00:00Z"),
    });
    expect(pickDefaultReportPeriod([older, newer])).toEqual({ id: "newer", name: "Newer" });
  });

  it("falls back to the latest historical attachment when no active+active candidate exists", () => {
    const inactiveAttachment = candidate({
      id: "inactive-attachment",
      name: "Inactive Attachment",
      periodActive: true,
      attachmentActive: false,
      startsAt: new Date("2026-02-01T00:00:00Z"),
    });
    const archivedPeriod = candidate({
      id: "archived-period",
      name: "Archived Period",
      periodActive: false,
      attachmentActive: true,
      startsAt: new Date("2026-01-01T00:00:00Z"),
    });

    expect(pickDefaultReportPeriod([inactiveAttachment, archivedPeriod])).toEqual({
      id: "inactive-attachment",
      name: "Inactive Attachment",
    });
  });

  it("ignores inactive candidates entirely when at least one active+active candidate exists", () => {
    const active = candidate({
      id: "active",
      name: "Active",
      startsAt: new Date("2026-01-01T00:00:00Z"),
    });
    const inactiveButNewer = candidate({
      id: "inactive-newer",
      name: "Inactive Newer",
      periodActive: false,
      startsAt: new Date("2026-06-01T00:00:00Z"),
    });

    expect(pickDefaultReportPeriod([active, inactiveButNewer])).toEqual({
      id: "active",
      name: "Active",
    });
  });

  it("breaks ties among historical fallback candidates by createdAt desc, then id desc", () => {
    const a = candidate({
      id: "a",
      name: "A",
      periodActive: false,
      startsAt: null,
      createdAt: new Date("2026-01-01T00:00:00Z"),
    });
    const b = candidate({
      id: "b",
      name: "B",
      periodActive: false,
      startsAt: null,
      createdAt: new Date("2026-01-02T00:00:00Z"),
    });
    expect(pickDefaultReportPeriod([a, b])).toEqual({ id: "b", name: "B" });
  });
});
