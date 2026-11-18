CREATE TABLE "MemberSelfAccessDecision" (
  "id" SERIAL PRIMARY KEY,
  "allianceId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "accountUserId" TEXT NOT NULL,
  "accountName" TEXT NOT NULL,
  "playerName" TEXT NOT NULL,
  "granted" BOOLEAN NOT NULL,
  "identityDecisionId" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "actorRole" "AllianceRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "MemberSelfAccessDecision_allianceId_memberId_id_idx"
  ON "MemberSelfAccessDecision" ("allianceId", "memberId", "id");
CREATE FUNCTION immutable_member_self_access_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Member access decisions are immutable';
END; $$;
CREATE TRIGGER immutable_member_self_access_decision BEFORE UPDATE OR DELETE ON "MemberSelfAccessDecision"
  FOR EACH ROW EXECUTE FUNCTION immutable_member_self_access_decision();
-- No backfill: identity confirmation and historical links do not grant access.
