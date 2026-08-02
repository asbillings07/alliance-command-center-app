import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { createIsolatedIntegrationDatabase } from "../testing/isolatedIntegrationDatabase";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration("Metric.trendDirection migration [integration]", () => {
  let isolated: Awaited<ReturnType<typeof createIsolatedIntegrationDatabase>>;
  let prisma: PrismaClient;
  let allianceId: string;

  beforeAll(async () => {
    isolated = await createIsolatedIntegrationDatabase("metric-trend-direction-migration");
    prisma = isolated.prisma;

    const alliance = await prisma.alliance.create({
      data: { name: "Trend Direction Migration Alliance", server: "1001" },
    });
    allianceId = alliance.id;
  });

  afterAll(async () => {
    await isolated.dispose();
  });

  it("backfills an existing-shape row (inserted without trendDirection) to NEUTRAL, never reinterpreting it as directional", async () => {
    const id = `metric-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    await prisma.$executeRaw`
      INSERT INTO "Metric" ("id", "allianceId", "name", "type", "summaryKind", "createdAt")
      VALUES (${id}, ${allianceId}, ${id}, 'NUMERIC'::"Metric_Type", 'NONE'::"MetricSummaryKind", NOW())
    `;

    const metric = await prisma.metric.findUniqueOrThrow({ where: { id } });
    expect(metric.trendDirection).toBe("NEUTRAL");
  });

  it("accepts all three explicit directions", async () => {
    for (const trendDirection of ["HIGHER_IS_BETTER", "LOWER_IS_BETTER", "NEUTRAL"] as const) {
      const metric = await prisma.metric.create({
        data: {
          allianceId,
          name: `Direction ${trendDirection} ${crypto.randomUUID().slice(0, 8)}`,
          type: "NUMERIC",
          trendDirection,
        },
      });
      expect(metric.trendDirection).toBe(trendDirection);
    }
  });
});
