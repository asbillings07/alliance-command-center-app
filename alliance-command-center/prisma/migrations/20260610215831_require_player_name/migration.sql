/*
  Warnings:

  - A unique constraint covering the columns `[playerName]` on the table `Member` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "Member_playerName_key" ON "Member"("playerName");
