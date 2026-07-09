/*
  Warnings:

  - A unique constraint covering the columns `[allianceId,playerName]` on the table `AllianceMember` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "AllianceMember_allianceId_playerName_key" ON "AllianceMember"("allianceId", "playerName");
