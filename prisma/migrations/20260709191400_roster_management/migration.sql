-- AlterTable
ALTER TABLE "AllianceMember" RENAME CONSTRAINT "Member_pkey" TO "AllianceMember_pkey";

-- RenameForeignKey
ALTER TABLE "AllianceMember" RENAME CONSTRAINT "Member_allianceId_fkey" TO "AllianceMember_allianceId_fkey";
