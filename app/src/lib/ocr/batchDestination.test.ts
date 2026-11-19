import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@/app/generated/prisma/client";
import { planBatchDestination } from "./batchDestination";

const allianceId = "alliance";
const input = {
  allianceId,
  periodId: "auto",
  week: "2026-11-16",
  dailyMetric: "auto",
  weeklyMetric: "auto",
};
const period = {
  id: "period",
  active: true,
  name: "Week 1",
  startsAt: new Date(input.week),
  endsAt: new Date("2026-11-22"),
};
const metric = {
  id: "daily",
  active: true,
  type: "NUMERIC",
  name: "Daily VS",
  observationGrain: "DAILY_OBSERVATION",
};
function database(
  periods = [period],
  metrics = [metric],
  links: { metricId: string }[] = [],
) {
  const read = (rows: unknown[]) => vi.fn().mockResolvedValue(rows);
  return {
    metricPeriod: { findMany: read(periods) },
    metric: { findMany: read(metrics) },
    metricPeriodMetric: { findMany: read(links) },
  } as unknown as Prisma.TransactionClient;
}
describe("screenshot import destinations", () => {
  it("reuses the matching period and attaches a recognized VS metric from this alliance", async () => {
    const tx = database();
    const plan = await planBatchDestination(tx, input, [input.week], "LEADER");
    expect(plan.periodId).toBe(period.id);
    expect(plan.changes).toEqual(["Attach Daily VS"]);
    expect(tx.metric.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { allianceId } }),
    );
    expect(tx.metricPeriod.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { allianceId } }),
    );
  });
  it("leaves active links alone and preserves daily and weekly grain", async () => {
    const plan = await planBatchDestination(
      database([period], [metric], [{ metricId: "daily" }]),
      input,
      [input.week, "week:" + input.week],
      "LEADER",
    );
    expect(plan.changes).toEqual(["Create and attach Weekly VS points"]);
    expect(plan.metrics.map((m) => m.target.disposition)).toEqual([
      "existing",
      "create",
    ]);
  });
  it("requires an explicit choice for two eligible periods", async () => {
    const tx = database([period, { ...period, id: "second" }]);
    await expect(
      planBatchDestination(tx, input, [input.week], "OWNER"),
    ).rejects.toThrow("Several periods");
    expect(
      (
        await planBatchDestination(
          tx,
          { ...input, periodId: "second" },
          [input.week],
          "OWNER",
        )
      ).periodId,
    ).toBe("second");
  });
  it("rejects missing or foreign IDs, conflicting grains, archived weeks and unauthorized setup", async () => {
    await expect(
      planBatchDestination(
        database(),
        { ...input, dailyMetric: "foreign" },
        [input.week],
        "OWNER",
      ),
    ).rejects.toThrow("alliance metric");
    await expect(
      planBatchDestination(
        database(),
        { ...input, periodId: "foreign" },
        [input.week],
        "OWNER",
      ),
    ).rejects.toThrow("active evaluation period");
    await expect(
      planBatchDestination(
        database(),
        { ...input, weeklyMetric: "daily" },
        ["week:" + input.week],
        "OWNER",
      ),
    ).rejects.toThrow("score type");
    await expect(
      planBatchDestination(
        database([{ ...period, active: false }]),
        input,
        [input.week],
        "OWNER",
      ),
    ).rejects.toThrow("already uses");
    await expect(
      planBatchDestination(database([], []), input, [input.week], "VIEWER"),
    ).rejects.toThrow("configuration access");
  });
});
