/*
  Warnings:

  - The values [DEMOTION] on the enum `LeadershipNoteType` will be removed. If these variants are still used in the database, this will fail.
  - Added the required column `updatedAt` to the `LeadershipNote` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
UPDATE "LeadershipNote" SET "noteType" = 'WARNING' WHERE "noteType" = 'DEMOTION';
ALTER TYPE "LeadershipNoteType" RENAME TO "LeadershipNoteType_old";
CREATE TYPE "LeadershipNoteType" AS ENUM ('POSITIVE', 'WARNING', 'OBSERVATION', 'PROMOTION');
ALTER TABLE "LeadershipNote" ALTER COLUMN "noteType" TYPE "LeadershipNoteType" USING ("noteType"::text::"LeadershipNoteType");
DROP TYPE "LeadershipNoteType_old";
COMMIT;

-- AlterTable
ALTER TABLE "LeadershipNote" ADD COLUMN     "updatedAt" TIMESTAMP(3);
UPDATE "LeadershipNote" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "LeadershipNote" ALTER COLUMN "updatedAt" SET NOT NULL;
