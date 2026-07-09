-- Add userId to AllianceMember for linking collaborators to roster members
ALTER TABLE "AllianceMember" ADD COLUMN "userId" TEXT;

-- Create index for efficient lookups by alliance and user
CREATE INDEX "AllianceMember_allianceId_userId_idx" ON "AllianceMember"("allianceId", "userId");

-- Add foreign key constraint
ALTER TABLE "AllianceMember" ADD CONSTRAINT "AllianceMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Create Invitation table
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "allianceId" TEXT NOT NULL,
    "invitedById" TEXT NOT NULL,
    "allianceMemberId" TEXT,
    "playerNameSnapshot" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "membershipRole" "AllianceRole" NOT NULL,
    "token" TEXT NOT NULL,
    "code" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- Create unique index on token
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- Create unique index on code (nullable)
CREATE UNIQUE INDEX "Invitation_code_key" ON "Invitation"("code");

-- Create index for looking up invitations by alliance and email
CREATE INDEX "Invitation_allianceId_email_idx" ON "Invitation"("allianceId", "email");

-- Create index for token lookups
CREATE INDEX "Invitation_token_idx" ON "Invitation"("token");

-- Create index for code lookups
CREATE INDEX "Invitation_code_idx" ON "Invitation"("code");

-- Add foreign key constraints
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_allianceId_fkey" FOREIGN KEY ("allianceId") REFERENCES "Alliance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_invitedById_fkey" FOREIGN KEY ("invitedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_allianceMemberId_fkey" FOREIGN KEY ("allianceMemberId") REFERENCES "AllianceMember"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_acceptedByUserId_fkey" FOREIGN KEY ("acceptedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
