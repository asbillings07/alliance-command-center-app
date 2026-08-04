-- CreateEnum
CREATE TYPE "MemberImportChangeType" AS ENUM ('CREATED', 'RESTORED');

-- CreateTable
CREATE TABLE "MemberImport" (
    "id" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmailSnapshot" TEXT NOT NULL,
    "actorDisplayNameSnapshot" TEXT,
    "fileName" TEXT,
    "sourceSheetName" TEXT,
    "createdCount" INTEGER NOT NULL,
    "restoredCount" INTEGER NOT NULL,
    "skippedExistingCount" INTEGER NOT NULL,
    "skippedDuplicateCount" INTEGER NOT NULL,
    "skippedEmptyNameCount" INTEGER NOT NULL,
    "skippedUnselectedCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberImportChange" (
    "id" TEXT NOT NULL,
    "memberImportId" TEXT NOT NULL,
    "allianceMemberId" TEXT,
    "playerNameSnapshot" TEXT NOT NULL,
    "sourceRow" INTEGER NOT NULL,
    "changeType" "MemberImportChangeType" NOT NULL,
    "archivedAtBefore" TIMESTAMP(3),
    "archivedAtAfter" TIMESTAMP(3),
    "thpBefore" INTEGER,
    "thpAfter" INTEGER,
    "roleBefore" TEXT,
    "roleAfter" TEXT,
    "discordNameAfter" TEXT,
    "squadPowerAfter" INTEGER,
    "joinedAtAfter" TIMESTAMP(3),
    "userIdAfter" TEXT,
    "memberUpdatedAtAfter" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberImportChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MemberImport_allianceId_createdAt_id_idx" ON "MemberImport"("allianceId", "createdAt" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "MemberImportChange_allianceMemberId_idx" ON "MemberImportChange"("allianceMemberId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberImportChange_memberImportId_sourceRow_key" ON "MemberImportChange"("memberImportId", "sourceRow");

-- AddForeignKey
ALTER TABLE "MemberImport" ADD CONSTRAINT "MemberImport_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImport" ADD CONSTRAINT "MemberImport_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImportChange" ADD CONSTRAINT "MemberImportChange_memberImportId_fkey" FOREIGN KEY ("memberImportId") REFERENCES "MemberImport"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberImportChange" ADD CONSTRAINT "MemberImportChange_allianceMemberId_fkey" FOREIGN KEY ("allianceMemberId") REFERENCES "AllianceMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- #277 PR 1 invariants: the application (action.ts) is the only writer of
-- these tables and already enforces every rule below; these CHECK
-- constraints exist purely so a bug there can never persist an inconsistent
-- provenance row (matches the AccessRequestTriageEvent precedent).

-- 1. Counts are never negative, and a MemberImport is never written for a
--    zero-net-effect commit (every row skipped) — see action.ts's history
--    gate (createdCount + restoredCount >= 1).
ALTER TABLE "MemberImport" ADD CONSTRAINT "MemberImport_counts_nonnegative_check"
  CHECK (
    "createdCount" >= 0
    AND "restoredCount" >= 0
    AND "skippedExistingCount" >= 0
    AND "skippedDuplicateCount" >= 0
    AND "skippedEmptyNameCount" >= 0
    AND "skippedUnselectedCount" >= 0
  );

ALTER TABLE "MemberImport" ADD CONSTRAINT "MemberImport_nonzero_effect_check"
  CHECK ("createdCount" + "restoredCount" >= 1);

-- 2. sourceRow is a 1-based row position; never zero or negative.
ALTER TABLE "MemberImportChange" ADD CONSTRAINT "MemberImportChange_sourceRow_positive_check"
  CHECK ("sourceRow" > 0);

-- 3. CREATED means the member didn't exist before this import, so every
--    "*Before" column must be null and the member is never archived
--    immediately after being created.
ALTER TABLE "MemberImportChange" ADD CONSTRAINT "MemberImportChange_created_before_state_check"
  CHECK (
    "changeType" != 'CREATED'
    OR (
      "thpBefore" IS NULL
      AND "roleBefore" IS NULL
      AND "archivedAtBefore" IS NULL
      AND "archivedAtAfter" IS NULL
    )
  );

-- 4. RESTORED means the member was archived before this import and is
--    unarchived (archivedAtAfter IS NULL) as a direct result of it.
ALTER TABLE "MemberImportChange" ADD CONSTRAINT "MemberImportChange_restored_before_state_check"
  CHECK (
    "changeType" != 'RESTORED'
    OR (
      "archivedAtBefore" IS NOT NULL
      AND "archivedAtAfter" IS NULL
    )
  );
