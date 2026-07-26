import { describe, it, expect } from "vitest";
import { sortAlliancePeriods } from "./multiPeriodImportUi";

describe("sortAlliancePeriods", () => {
  it("orders periods by startsAt with name fallback", () => {
    const sorted = sortAlliancePeriods([
      {
        id: "p3",
        name: "C Period",
        startsAt: null,
        endsAt: null,
        metrics: [],
      },
      {
        id: "p2",
        name: "B Period",
        startsAt: "2026-04-01T00:00:00.000Z",
        endsAt: "2026-04-07T00:00:00.000Z",
        metrics: [],
      },
      {
        id: "p1",
        name: "A Period",
        startsAt: "2026-03-01T00:00:00.000Z",
        endsAt: "2026-03-07T00:00:00.000Z",
        metrics: [],
      },
    ]);

    expect(sorted.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
  });
});
