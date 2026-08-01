import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PrismaClient } from "@/app/generated/prisma/client";
import { createIsolatedIntegrationDatabase } from "../testing/isolatedIntegrationDatabase";

const runDb = process.env.INTEGRATION_DB === "true";
const describeIntegration = runDb ? describe.sequential : describe.skip;

describeIntegration(
  "Metric.summaryKind <-> Metric.type CHECK constraint [integration]",
  () => {
    let isolated: Awaited<ReturnType<typeof createIsolatedIntegrationDatabase>>;
    let prisma: PrismaClient;
    let allianceId: string;

    beforeAll(async () => {
      isolated = await createIsolatedIntegrationDatabase("metric-summary-kind-check");
      prisma = isolated.prisma;

      const alliance = await prisma.alliance.create({
        data: { name: "Check Constraint Alliance", server: "1001" },
      });
      allianceId = alliance.id;
    });

    afterAll(async () => {
      await isolated.dispose();
    });

    function insertMetric(params: { type: string; summaryKind: string }) {
      const id = `metric-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return prisma.$executeRaw`
        INSERT INTO "Metric" ("id", "allianceId", "name", "type", "summaryKind", "createdAt")
        VALUES (
          ${id}, ${allianceId}, ${id}, ${params.type}::"Metric_Type",
          ${params.summaryKind}::"MetricSummaryKind", NOW()
        )
      `;
    }

    it.each([
      { type: "NUMERIC", summaryKind: "NONE" },
      { type: "NUMERIC", summaryKind: "SUM" },
      { type: "NUMERIC", summaryKind: "AVERAGE" },
      { type: "BOOLEAN", summaryKind: "NONE" },
      { type: "BOOLEAN", summaryKind: "TRUE_RATE" },
    ])("accepts $type with $summaryKind", async ({ type, summaryKind }) => {
      await expect(insertMetric({ type, summaryKind })).resolves.not.toThrow();
    });

    it.each([
      { type: "BOOLEAN", summaryKind: "SUM" },
      { type: "BOOLEAN", summaryKind: "AVERAGE" },
      { type: "NUMERIC", summaryKind: "TRUE_RATE" },
    ])("rejects $type with $summaryKind", async ({ type, summaryKind }) => {
      await expect(insertMetric({ type, summaryKind })).rejects.toThrow();
    });
  },
);
