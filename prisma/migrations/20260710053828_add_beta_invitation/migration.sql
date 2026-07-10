-- CreateTable
CREATE TABLE "BetaInvitation" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "allianceId" TEXT,

    CONSTRAINT "BetaInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BetaInvitation_email_key" ON "BetaInvitation"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BetaInvitation_token_key" ON "BetaInvitation"("token");

-- CreateIndex
CREATE UNIQUE INDEX "BetaInvitation_code_key" ON "BetaInvitation"("code");

-- AddForeignKey
ALTER TABLE "BetaInvitation" ADD CONSTRAINT "BetaInvitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BetaInvitation" ADD CONSTRAINT "BetaInvitation_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
