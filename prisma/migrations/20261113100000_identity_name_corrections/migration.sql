ALTER TABLE "MemberIdentityDecision" ADD COLUMN "previousPlayerName" TEXT;

-- Existing confirmation/revocation records remain unchanged. A correction
-- records the new name in playerName and must never also confirm identity.
ALTER TABLE "MemberIdentityDecision"
ADD CONSTRAINT "MemberIdentityDecision_name_correction_check"
CHECK ("previousPlayerName" IS NULL OR
  ("confirmed" = false AND "previousPlayerName" <> "playerName"));
