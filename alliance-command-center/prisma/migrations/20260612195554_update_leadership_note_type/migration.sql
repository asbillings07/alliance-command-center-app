/*
  Warnings:

  - The values [DEMOTION] on the enum `LeadershipNoteType` will be removed. If these variants are still used in the database, this will fail.
  - Added the required column `updatedAt` to the `LeadershipNote` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "LeadershipNoteType_new" AS ENUM ('POSITIVE', 'WARNING', 'OBSERVATION', 'PROMOTION');
ALTER TABLE "LeadershipNote" ALTER COLUMN "noteType" TYPE "LeadershipNoteType_new" USING ("noteType"::text::"LeadershipNoteType_new");
ALTER TYPE "LeadershipNoteType" RENAME TO "LeadershipNoteType_old";
ALTER TYPE "LeadershipNoteType_new" RENAME TO "LeadershipNoteType";
DROP TYPE "public"."LeadershipNoteType_old";
COMMIT;

-- AlterTable
ALTER TABLE "LeadershipNote" ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;
