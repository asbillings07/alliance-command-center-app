-- CreateEnum
CREATE TYPE "MemberImportRollbackResultResolution" AS ENUM ('DELETED', 'REVERTED_TO_PRE_IMPORT_STATE', 'RETAINED_ACTIVE', 'ARCHIVED_PRESERVING_HISTORY', 'RETAINED_ARCHIVED', 'SKIPPED_CONFLICT');

-- CreateEnum
CREATE TYPE "MemberImportRollbackOutcome" AS ENUM ('ROLLED_BACK', 'ROLLED_BACK_WITH_RETAINED_MEMBERS');

-- CreateTable
CREATE TABLE "MemberImportRollback" (
    "id" TEXT NOT NULL,
    "memberImportId" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmailSnapshot" TEXT NOT NULL,
    "actorDisplayNameSnapshot" TEXT,
    "outcome" "MemberImportRollbackOutcome" NOT NULL,
    "deletedCount" INTEGER NOT NULL,
    "revertedCount" INTEGER NOT NULL,
    "retainedActiveCount" INTEGER NOT NULL,
    "archivedPreservingHistoryCount" INTEGER NOT NULL,
    "retainedArchivedCount" INTEGER NOT NULL,
    "skippedConflictCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberImportRollback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberImportRollbackResult" (
    "id" TEXT NOT NULL,
    "memberImportRollbackId" TEXT NOT NULL,
    "memberImportChangeId" TEXT NOT NULL,
    "allianceMemberId" TEXT,
    "resolution" "MemberImportRollbackResultResolution" NOT NULL,
    "driftedFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hadLaterImportInvolvement" BOOLEAN NOT NULL DEFAULT false,
    "hadLinkedUser" BOOLEAN NOT NULL DEFAULT false,
    "metricEntryCount" INTEGER NOT NULL DEFAULT 0,
    "leadershipNoteCount" INTEGER NOT NULL DEFAULT 0,
    "invitationCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "MemberImportRollbackResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MemberImportRollback_memberImportId_key" ON "MemberImportRollback"("memberImportId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberImportRollbackResult_memberImportChangeId_key" ON "MemberImportRollbackResult"("memberImportChangeId");

-- CreateIndex
CREATE INDEX "MemberImportRollbackResult_memberImportRollbackId_idx" ON "MemberImportRollbackResult"("memberImportRollbackId");

-- AddForeignKey
ALTER TABLE "MemberImportRollback" ADD CONSTRAINT "MemberImportRollback_memberImportId_fkey" FOREIGN KEY ("memberImportId") REFERENCES "MemberImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImportRollback" ADD CONSTRAINT "MemberImportRollback_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImportRollback" ADD CONSTRAINT "MemberImportRollback_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImportRollbackResult" ADD CONSTRAINT "MemberImportRollbackResult_memberImportRollbackId_fkey" FOREIGN KEY ("memberImportRollbackId") REFERENCES "MemberImportRollback"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImportRollbackResult" ADD CONSTRAINT "MemberImportRollbackResult_memberImportChangeId_fkey" FOREIGN KEY ("memberImportChangeId") REFERENCES "MemberImportChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImportRollbackResult" ADD CONSTRAINT "MemberImportRollbackResult_allianceMemberId_fkey" FOREIGN KEY ("allianceMemberId") REFERENCES "AllianceMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;
