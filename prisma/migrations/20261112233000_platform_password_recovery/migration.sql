CREATE TABLE "PasswordRecoveryEvent" (
  "id" TEXT NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "targetUserId" TEXT NOT NULL,
  "targetEmail" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PasswordRecoveryEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PasswordRecoveryEvent_valid" CHECK (
    length(trim("actorUserId")) > 0 AND length(trim("targetUserId")) > 0
    AND length(trim("targetEmail")) > 0 AND "actorUserId" <> "targetUserId"
    AND "expiresAt" > "createdAt"
  )
);
CREATE INDEX "PasswordRecoveryEvent_targetUserId_createdAt_idx" ON "PasswordRecoveryEvent"("targetUserId", "createdAt");
CREATE FUNCTION prevent_password_recovery_event_update() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Password recovery issuance history is immutable';
END;
$$;
CREATE TRIGGER "PasswordRecoveryEvent_no_update" BEFORE UPDATE ON "PasswordRecoveryEvent"
FOR EACH ROW EXECUTE FUNCTION prevent_password_recovery_event_update();
