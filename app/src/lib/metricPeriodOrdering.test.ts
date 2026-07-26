import { describe, it, expect } from "vitest";
import {
  compareMetricPeriodsForCurrent,
  pickCurrentMetricPeriod,
} from "./metricPeriodOrdering";

function period(
  id: string,
  startsAt: Date | null,
  createdAt: Date,
) {
  return { id, startsAt, createdAt };
}

describe("metricPeriodOrdering", () => {
  it("prefers later startsAt over newer createdAt", () => {
    const current = period("current", new Date("2026-04-01"), new Date("2026-01-01"));
    const importedHistorical = period(
      "imported",
      new Date("2026-03-01"),
      new Date("2026-07-01"),
    );

    expect(pickCurrentMetricPeriod([importedHistorical, current])?.id).toBe("current");
  });

  it("sorts null startsAt after dated periods", () => {
    const dated = period("dated", new Date("2026-02-01"), new Date("2026-01-01"));
    const undated = period("undated", null, new Date("2026-12-01"));

    expect(pickCurrentMetricPeriod([undated, dated])?.id).toBe("dated");
  });

  it("uses createdAt then id when startsAt ties", () => {
    const sameStartOlderCreated = period(
      "older-created",
      new Date("2026-03-01"),
      new Date("2026-02-01"),
    );
    const sameStartNewerCreated = period(
      "newer-created",
      new Date("2026-03-01"),
      new Date("2026-03-15"),
    );

    expect(
      compareMetricPeriodsForCurrent(sameStartOlderCreated, sameStartNewerCreated),
    ).toBeGreaterThan(0);
    expect(pickCurrentMetricPeriod([sameStartOlderCreated, sameStartNewerCreated])?.id).toBe(
      "newer-created",
    );
  });
});
