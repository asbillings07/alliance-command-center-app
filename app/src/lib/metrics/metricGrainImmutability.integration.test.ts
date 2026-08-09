import { describe, it, expect, beforeAll, afterEach } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";

const runDb = process.env.INTEGRATION_DB === "true";

// #287 database design §4a: Metric.type/observationGrain/memberPeriodRollup
// are immutable after creation - a strictly stronger guarantee than the
// existing app-only `type` precedent in metrics/action.ts.
describe.skipIf(!runDb)("Metric reporting-field immutability [integration]", () => {
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

  async function makeMetric() {
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const alliance = await prisma.alliance.create({
      data: { name: `Metric Grain Immutability Alliance ${suffix}`, server: "1001" },
    });
    createdAllianceIds.push(alliance.id);

    const metric = await prisma.metric.create({
      data: { allianceId: alliance.id, name: "Score", type: "NUMERIC" },
    });

    return { alliance, metric };
  }

  it("rejects changing type after creation", async () => {
    const { metric } = await makeMetric();

    await expect(
      prisma.metric.update({ where: { id: metric.id }, data: { type: "BOOLEAN" } }),
    ).rejects.toThrow(/immutable after creation/i);
  });

  it("rejects changing observationGrain after creation", async () => {
    const { metric } = await makeMetric();

    await expect(
      prisma.metric.update({
        where: { id: metric.id },
        data: { observationGrain: "DAILY_OBSERVATION" },
      }),
    ).rejects.toThrow(/immutable after creation/i);
  });

  it("rejects changing memberPeriodRollup after creation", async () => {
    const { metric } = await makeMetric();

    await expect(
      prisma.metric.update({ where: { id: metric.id }, data: { memberPeriodRollup: "SUM" } }),
    ).rejects.toThrow(/immutable after creation/i);
  });

  it("still allows editing name/description/summaryKind/unitLabel/trendDirection", async () => {
    const { metric } = await makeMetric();

    await expect(
      prisma.metric.update({
        where: { id: metric.id },
        data: { name: "Renamed Score", description: "Updated", unitLabel: "pts" },
      }),
    ).resolves.not.toThrow();
  });
});
