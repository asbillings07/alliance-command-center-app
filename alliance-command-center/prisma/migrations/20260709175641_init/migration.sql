-- CreateEnum
CREATE TYPE "AllianceRole" AS ENUM ('OWNER', 'ADMIN', 'LEADER', 'VIEWER');

-- CreateEnum
CREATE TYPE "Metric_Type" AS ENUM ('NUMERIC', 'BOOLEAN');

-- CreateEnum
CREATE TYPE "LeadershipNoteType" AS ENUM ('POSITIVE', 'WARNING', 'OBSERVATION', 'PROMOTION');

-- CreateEnum
CREATE TYPE "LeadershipNoteVisibility" AS ENUM ('LEADERSHIP', 'ADMIN');

-- CreateTable
CREATE TABLE "Alliance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "server" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllianceMembership" (
    "id" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "AllianceRole" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllianceMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllianceMember" (
    "id" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "discordName" TEXT,
    "thp" INTEGER,
    "squadPower" INTEGER,
    "role" TEXT,
    "joinDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AllianceMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "preferredLanguage" TEXT NOT NULL DEFAULT 'en',
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Metric" (
    "id" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "type" "Metric_Type" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Metric_pkey" PRIMARY KEY ("id")
);

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

-- CreateTable
CREATE TABLE "MemberMetricEntry" (
    "id" TEXT NOT NULL,
    "allianceMemberId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "metricId" TEXT NOT NULL,
    "value" INTEGER NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberMetricEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadershipNote" (
    "id" TEXT NOT NULL,
    "allianceMemberId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "noteType" "LeadershipNoteType" NOT NULL,
    "visibility" "LeadershipNoteVisibility" NOT NULL,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadershipNote_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Alliance_name_server_key" ON "Alliance"("name", "server");

-- CreateIndex
CREATE UNIQUE INDEX "AllianceMembership_allianceId_userId_key" ON "AllianceMembership"("allianceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "AllianceMember_allianceId_playerName_key" ON "AllianceMember"("allianceId", "playerName");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Metric_allianceId_name_key" ON "Metric"("allianceId", "name");

-- CreateIndex
CREATE INDEX "MemberMetricEntry_allianceMemberId_periodId_idx" ON "MemberMetricEntry"("allianceMemberId", "periodId");

-- CreateIndex
CREATE INDEX "MemberMetricEntry_metricId_idx" ON "MemberMetricEntry"("metricId");

-- AddForeignKey
ALTER TABLE "AllianceMembership" ADD CONSTRAINT "AllianceMembership_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllianceMembership" ADD CONSTRAINT "AllianceMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllianceMember" ADD CONSTRAINT "AllianceMember_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Metric" ADD CONSTRAINT "Metric_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricPeriod" ADD CONSTRAINT "MetricPeriod_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricPeriodMetric" ADD CONSTRAINT "MetricPeriodMetric_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "MetricPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MetricPeriodMetric" ADD CONSTRAINT "MetricPeriodMetric_metricId_fkey" FOREIGN KEY ("metricId") REFERENCES "Metric"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "MemberMetricEntry_allianceMemberId_fkey" FOREIGN KEY ("allianceMemberId") REFERENCES "AllianceMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMetricEntry" ADD CONSTRAINT "MemberMetricEntry_periodId_metricId_fkey" FOREIGN KEY ("periodId", "metricId") REFERENCES "MetricPeriodMetric"("periodId", "metricId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipNote" ADD CONSTRAINT "LeadershipNote_allianceMemberId_fkey" FOREIGN KEY ("allianceMemberId") REFERENCES "AllianceMember"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadershipNote" ADD CONSTRAINT "LeadershipNote_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
