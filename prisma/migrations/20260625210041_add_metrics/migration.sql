/*
  Warnings:

  - The values [LEADERSHIP] on the enum `Metric_Type` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `notes` on the `MemberMetricEntry` table. All the data in the column will be lost.
  - You are about to drop the column `score` on the `MemberMetricEntry` table. All the data in the column will be lost.
  - You are about to drop the column `active` on the `Metric` table. All the data in the column will be lost.
  - You are about to drop the column `weight` on the `Metric` table. All the data in the column will be lost.
  - Added the required column `periodId` to the `MemberMetricEntry` table without a default value. This is not possible if the table is not empty.
  - Added the required column `value` to the `MemberMetricEntry` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "Metric_Type_new" AS ENUM ('NUMERIC', 'BOOLEAN');
ALTER TABLE "Metric" ALTER COLUMN "type" TYPE "Metric_Type_new" USING ("type"::text::"Metric_Type_new");
ALTER TYPE "Metric_Type" RENAME TO "Metric_Type_old";
ALTER TYPE "Metric_Type_new" RENAME TO "Metric_Type";
DROP TYPE "public"."Metric_Type_old";
COMMIT;

-- AlterTable
ALTER TABLE "LeadershipNote" ALTER COLUMN "updatedAt" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "MemberMetricEntry" DROP COLUMN "notes",
DROP COLUMN "score",
ADD COLUMN     "periodId" TEXT NOT NULL,
ADD COLUMN     "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "value" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "Metric" DROP COLUMN "active",
DROP COLUMN "weight";

-- CreateTable
CREATE TABLE "MetricPeriod" (
    "id" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MetricPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MetricPeriodMetric" (
    "periodId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "MetricPeriodMetric_pkey" PRIMARY KEY ("periodId","metricId")
);

-- CreateIndex
CREATE INDEX "MemberMetricEntry_memberId_periodId_idx" ON "MemberMetricEntry"("memberId", "periodId");

-- CreateIndex
CREATE INDEX "MemberMetricEntry_metricId_idx" ON "MemberMetricEntry"("metricId");

-- AddForeignKey
ALTER TABLE "MetricPeriod" ADD CONSTRAINT "MetricPeriod_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricPeriodMetric" ADD CONSTRAINT "MetricPeriodMetric_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "MetricPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricPeriodMetric" ADD CONSTRAINT "MetricPeriodMetric_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "Metric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "MemberMetricEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "MetricPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "MemberMetricEntry_periodId_metricId_fkey" FOREIGN KEY ("periodId", "metricId") REFERENCES "MetricPeriodMetric"("periodId", "metricId") ON DELETE RESTRICT ON UPDATE CASCADE;
