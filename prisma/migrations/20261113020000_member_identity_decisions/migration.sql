ALTER TABLE "Alliance" ADD COLUMN "identityVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AllianceMember" ADD COLUMN "identityVersion" INTEGER NOT NULL DEFAULT 0;

-- Apply to every writer, including old application instances and imports.
CREATE FUNCTION alliance_identity_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."identityVersion" := OLD."identityVersion" + CASE WHEN
    (NEW."name", NEW."server") IS DISTINCT FROM (OLD."name", OLD."server") THEN 1 ELSE 0 END;
  RETURN NEW;
END; $$;
CREATE TRIGGER alliance_identity_version BEFORE UPDATE ON "Alliance"
  FOR EACH ROW EXECUTE FUNCTION alliance_identity_version();

CREATE FUNCTION member_identity_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."identityVersion" := OLD."identityVersion" + CASE WHEN
    (NEW."allianceId", NEW."playerName", NEW."userId", NEW."archivedAt") IS DISTINCT FROM
    (OLD."allianceId", OLD."playerName", OLD."userId", OLD."archivedAt") THEN 1 ELSE 0 END;
  RETURN NEW;
END; $$;
CREATE TRIGGER member_identity_version BEFORE UPDATE ON "AllianceMember"
  FOR EACH ROW EXECUTE FUNCTION member_identity_version();

CREATE TABLE "MemberIdentityDecision" (
  "id" SERIAL PRIMARY KEY,
  "allianceId" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "confirmed" BOOLEAN NOT NULL,
  "accountUserId" TEXT,
  "playerName" TEXT NOT NULL,
  "allianceName" TEXT NOT NULL,
  "server" TEXT NOT NULL,
  "memberVersion" INTEGER NOT NULL,
  "allianceVersion" INTEGER NOT NULL,
  "actorUserId" TEXT NOT NULL,
  "actorName" TEXT NOT NULL,
  "actorRole" "AllianceRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "member_identity_confirmation_complete" CHECK (
    NOT "confirmed" OR ("accountUserId" IS NOT NULL AND length(trim("playerName")) > 0
      AND length(trim("allianceName")) > 0 AND length(trim("server")) > 0)
  )
);
CREATE INDEX "MemberIdentityDecision_allianceId_memberId_id_idx"
  ON "MemberIdentityDecision" ("allianceId", "memberId", "id");
CREATE FUNCTION immutable_member_identity_decision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Member identity decisions are immutable';
END; $$;
CREATE TRIGGER immutable_member_identity_decision BEFORE UPDATE OR DELETE ON "MemberIdentityDecision"
  FOR EACH ROW EXECUTE FUNCTION immutable_member_identity_decision();
