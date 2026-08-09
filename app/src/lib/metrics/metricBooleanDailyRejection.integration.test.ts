import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §3a: extends the existing metric_summary_kind_
// matches_type CHECK to also require DAILY_OBSERVATION metrics be NUMERIC -
// a BOOLEAN daily metric's SUM/AVERAGE rollup would produce values the
// existing TRUE_RATE alliance-summary layer can't interpret (e.g. 1,1,0 ->
// SUM 2 or AVERAGE 0.667).
describe.skipIf(!runDb)("Metric grain/rollup/type compatibility CHECK [integration]", () => {
  let prisma: PrismaClient;
  const createdAllianceIds: string[] = [];

  beforeAll(async () => {
    ({ prisma } = (await import("@/app/src/lib/prisma")) as unknown as {
      prisma: PrismaClient;
    });
  });

  afterEach(async () => {
    if (createdAllianceIds.length > 0) {
      await prisma.metric.deleteMany({ where: { allianceId: { in: createdAllianceIds } } });
      await prisma.alliance.deleteMany({ where: { id: { in: createdAllianceIds } } });
      createdAllianceIds.length = 0;
    }
  });

  async function makeAlliance() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Boolean Daily Rejection Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);
    return alliance;
  }

  it("rejects a BOOLEAN metric configured as DAILY_OBSERVATION + SUM", async () => {
    const alliance = await makeAlliance();

    await expect(
      prisma.metric.create({
        data: {
          allianceId: alliance.id,
          name: "Daily Boolean",
          type: "BOOLEAN",
          observationGrain: "DAILY_OBSERVATION",
          memberPeriodRollup: "SUM",
        },
      }),
    ).rejects.toThrow(/constraint/i);
  });

  it("rejects a BOOLEAN metric configured as DAILY_OBSERVATION + AVERAGE", async () => {
    const alliance = await makeAlliance();

    await expect(
      prisma.metric.create({
        data: {
          allianceId: alliance.id,
          name: "Daily Boolean",
          type: "BOOLEAN",
          observationGrain: "DAILY_OBSERVATION",
          memberPeriodRollup: "AVERAGE",
        },
      }),
    ).rejects.toThrow(/constraint/i);
  });

  it("rejects DAILY_OBSERVATION paired with LATEST for BOOLEAN too - the type restriction is independent of rollup kind", async () => {
    const alliance = await makeAlliance();

    await expect(
      prisma.metric.create({
        data: {
          allianceId: alliance.id,
          name: "Daily Boolean Latest",
          type: "BOOLEAN",
          observationGrain: "DAILY_OBSERVATION",
          memberPeriodRollup: "LATEST",
        },
      }),
    ).rejects.toThrow(/constraint/i);
  });

  it("rejects PERIOD_VALUE paired with a non-LATEST rollup", async () => {
    const alliance = await makeAlliance();

    await expect(
      prisma.metric.create({
        data: {
          allianceId: alliance.id,
          name: "Period Value Sum",
          type: "NUMERIC",
          observationGrain: "PERIOD_VALUE",
          memberPeriodRollup: "SUM",
        },
      }),
    ).rejects.toThrow(/constraint/i);
  });

  it("accepts a NUMERIC metric configured as DAILY_OBSERVATION + SUM", async () => {
    const alliance = await makeAlliance();

    await expect(
      prisma.metric.create({
        data: {
          allianceId: alliance.id,
          name: "Daily Numeric",
          type: "NUMERIC",
          observationGrain: "DAILY_OBSERVATION",
          memberPeriodRollup: "SUM",
        },
      }),
    ).resolves.not.toThrow();
  });

  it("still accepts a BOOLEAN metric configured as PERIOD_VALUE + LATEST (today's only valid Boolean shape)", async () => {
    const alliance = await makeAlliance();

    await expect(
      prisma.metric.create({
        data: {
          allianceId: alliance.id,
          name: "Weekly Boolean",
          type: "BOOLEAN",
          observationGrain: "PERIOD_VALUE",
          memberPeriodRollup: "LATEST",
        },
      }),
    ).resolves.not.toThrow();
  });
});
