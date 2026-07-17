-- CreateEnum
CREATE TYPE "AuthProvider" AS ENUM ('PASSWORD', 'GOOGLE');

-- AlterTable: allow OAuth-only users to have no password, and record how a user authenticates
ALTER TABLE "User" ADD COLUMN     "authProvider" "AuthProvider" NOT NULL DEFAULT 'PASSWORD',
ALTER COLUMN "passwordHash" DROP NOT NULL;
