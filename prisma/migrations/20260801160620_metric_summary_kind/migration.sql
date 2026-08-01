-- CreateEnum
CREATE TYPE "MetricSummaryKind" AS ENUM ('SUM', 'AVERAGE', 'TRUE_RATE', 'NONE');

-- AlterTable
ALTER TABLE "Metric" ADD COLUMN     "summaryKind" "MetricSummaryKind" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "unitLabel" TEXT;

-- CreateIndex
CREATE INDEX "MemberMetricEntry_periodId_metricId_allianceMemberId_record_idx" ON "MemberMetricEntry"("periodId", "metricId", "allianceMemberId", "recordedAt" DESC, "createdAt" DESC, "id" DESC);

-- #190: (type, summaryKind) invariant is enforced application-side in
-- metrics/action.ts (fast, friendly validation) and here as the actual
-- guarantee, so a bug in that layer can never persist a nonsensical
-- combination (e.g. a BOOLEAN metric configured to SUM). type is also
-- immutable after creation at the application layer, which is what keeps
-- this constraint valid for the lifetime of a metric's historical entries.
ALTER TABLE "Metric" ADD CONSTRAINT "metric_summary_kind_matches_type" CHECK (
  ("type" = 'NUMERIC' AND "summaryKind" IN ('NONE', 'SUM', 'AVERAGE'))
  OR ("type" = 'BOOLEAN' AND "summaryKind" IN ('NONE', 'TRUE_RATE'))
);
