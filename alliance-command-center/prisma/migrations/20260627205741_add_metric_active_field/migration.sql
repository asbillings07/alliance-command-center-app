-- DropForeignKey
ALTER TABLE "MemberMetricEntry" DROP CONSTRAINT "MemberMetricEntry_metricId_fkey";

-- DropForeignKey
ALTER TABLE "MemberMetricEntry" DROP CONSTRAINT "MemberMetricEntry_periodId_fkey";

-- AlterTable
ALTER TABLE "Metric" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true;
