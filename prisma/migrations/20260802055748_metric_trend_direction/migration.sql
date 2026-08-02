-- CreateEnum
CREATE TYPE "MetricTrendDirection" AS ENUM ('HIGHER_IS_BETTER', 'LOWER_IS_BETTER', 'NEUTRAL');

-- AlterTable
ALTER TABLE "Metric" ADD COLUMN     "trendDirection" "MetricTrendDirection" NOT NULL DEFAULT 'NEUTRAL';
