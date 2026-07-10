-- CreateTable
CREATE TABLE "Alliance" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "server" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Alliance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "playerName" TEXT NOT NULL,
    "discordName" TEXT,
    "thp" INTEGER,
    "squadPower" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
