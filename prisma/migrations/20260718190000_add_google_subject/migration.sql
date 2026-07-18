-- Model authentication as capabilities: add the Google subject anchor and
-- retire the mutually-exclusive AuthProvider enum. A user with a passwordHash
-- can log in with a password; a user with a googleSubject can log in with
-- Google; a user may have both.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "googleSubject" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_googleSubject_key" ON "User"("googleSubject");

-- DropColumn + DropEnum (capability columns are now the source of truth)
ALTER TABLE "User" DROP COLUMN "authProvider";
DROP TYPE "AuthProvider";
