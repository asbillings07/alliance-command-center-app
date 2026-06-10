/*
  Warnings:

  - A unique constraint covering the columns `[name,server]` on the table `Alliance` will be added. If there are existing duplicate values, this will fail.
  - Made the column `server` on table `Alliance` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Alliance_name_key";

-- AlterTable
ALTER TABLE "Alliance" ALTER COLUMN "server" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Alliance_name_server_key" ON "Alliance"("name", "server");
