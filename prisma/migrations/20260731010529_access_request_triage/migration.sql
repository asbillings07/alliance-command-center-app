-- CreateEnum
CREATE TYPE "AccessRequestTriageStatus" AS ENUM ('PENDING', 'INVITED', 'DECLINED', 'RESOLVED_EXISTING_ACCESS');

-- CreateEnum
CREATE TYPE "AccessRequestTriageEventType" AS ENUM ('NOTE_ADDED', 'CONVERSION_BLOCKED', 'INVITED', 'DECLINED', 'REOPENED', 'RESOLVED_EXISTING_ACCESS');

-- CreateEnum
CREATE TYPE "InvitationConflictType" AS ENUM ('NONE', 'ACTIVE_PENDING_INVITATION', 'EXISTING_ALLIANCE_ACCESS', 'IDENTITY_AMBIGUOUS', 'ALREADY_ACCEPTED', 'EXISTING_PARTICIPANT_REISSUE');

-- Pre-existing drift fix, unrelated to #177: "participantId" has been a
-- required (NOT NULL) column since 20260728190000_beta_participant_contract,
-- so this FK's ON DELETE SET NULL clause has been dead code ever since (it
-- can never fire against a NOT NULL column). Prisma's migration diff surfaces
-- the mismatch between the live constraint and the schema's implicit RESTRICT
-- default for a required relation now that a new migration is being created;
-- correcting it here just makes the declared and actual constraint agree —
-- behavior is unchanged (deleting a still-referenced BetaParticipant was
-- already impossible either way).
-- DropForeignKey
ALTER TABLE "BetaInvitation" DROP CONSTRAINT "BetaInvitation_participantId_fkey";

-- CreateTable
CREATE TABLE "AccessRequestTriage" (
    "accessRequestId" TEXT NOT NULL,
    "status" "AccessRequestTriageStatus" NOT NULL DEFAULT 'PENDING',
    "linkedInvitationId" TEXT,
    "betaWave" TEXT,
    "conflictUserId" TEXT,
    "conflictUserIdSnapshot" TEXT,
    "conflictUserEmail" TEXT,
    "conflictUserDisplayName" TEXT,
    "conflictAllianceId" TEXT,
    "conflictAllianceIdSnapshot" TEXT,
    "conflictAllianceName" TEXT,
    "conflictMembershipCount" INTEGER,
    "currentReason" TEXT,
    "stateRevision" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3),
    "lastEventActorEmail" TEXT,
    "lastEventActorDisplayName" TEXT,
    "lastStateChangeAt" TIMESTAMP(3),
    "lastStateChangeActorEmail" TEXT,
    "lastStateChangeActorDisplayName" TEXT,

    CONSTRAINT "AccessRequestTriage_pkey" PRIMARY KEY ("accessRequestId")
);

-- CreateTable
CREATE TABLE "AccessRequestTriageEvent" (
    "id" TEXT NOT NULL,
    "accessRequestId" TEXT NOT NULL,
    "eventType" "AccessRequestTriageEventType" NOT NULL,
    "previousStatus" "AccessRequestTriageStatus",
    "nextStatus" "AccessRequestTriageStatus",
    "noteText" TEXT,
    "declineReason" TEXT,
    "resolutionReason" TEXT,
    "reopenReason" TEXT,
    "betaWave" TEXT,
    "blockedReason" TEXT,
    "blockedConflictType" "InvitationConflictType",
    "conflictUserId" TEXT,
    "conflictUserIdSnapshot" TEXT,
    "conflictUserEmail" TEXT,
    "conflictUserDisplayName" TEXT,
    "conflictAllianceId" TEXT,
    "conflictAllianceIdSnapshot" TEXT,
    "conflictAllianceName" TEXT,
    "conflictMembershipCount" INTEGER,
    "conflictInvitationId" TEXT,
    "conflictParticipantId" TEXT,
    "conflictParticipantIdSnapshots" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "linkedInvitationId" TEXT,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "actorDisplayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccessRequestTriageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AccessRequestTriage_linkedInvitationId_key" ON "AccessRequestTriage"("linkedInvitationId");

-- CreateIndex
CREATE INDEX "AccessRequestTriage_status_idx" ON "AccessRequestTriage"("status");

-- CreateIndex
CREATE INDEX "AccessRequestTriage_betaWave_idx" ON "AccessRequestTriage"("betaWave");

-- CreateIndex
CREATE INDEX "AccessRequestTriageEvent_accessRequestId_createdAt_id_idx" ON "AccessRequestTriageEvent"("accessRequestId", "createdAt", "id");

-- CreateIndex
CREATE INDEX "AccessRequestTriageEvent_actorUserId_idx" ON "AccessRequestTriageEvent"("actorUserId");

-- CreateIndex
CREATE INDEX "AccessRequestTriageEvent_linkedInvitationId_idx" ON "AccessRequestTriageEvent"("linkedInvitationId");

-- AddForeignKey
ALTER TABLE "BetaInvitation" ADD CONSTRAINT "BetaInvitation_participantId_fkey" FOREIGN KEY ("participantId") REFERENCES "BetaParticipant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_accessRequestId_fkey" FOREIGN KEY ("accessRequestId") REFERENCES "AccessRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_linkedInvitationId_fkey" FOREIGN KEY ("linkedInvitationId") REFERENCES "BetaInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_conflictUserId_fkey" FOREIGN KEY ("conflictUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_conflictAllianceId_fkey" FOREIGN KEY ("conflictAllianceId") REFERENCES "Alliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_accessRequestId_fkey" FOREIGN KEY ("accessRequestId") REFERENCES "AccessRequest"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictUserId_fkey" FOREIGN KEY ("conflictUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictAllianceId_fkey" FOREIGN KEY ("conflictAllianceId") REFERENCES "Alliance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictInvitationId_fkey" FOREIGN KEY ("conflictInvitationId") REFERENCES "BetaInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictParticipantId_fkey" FOREIGN KEY ("conflictParticipantId") REFERENCES "BetaParticipant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_linkedInvitationId_fkey" FOREIGN KEY ("linkedInvitationId") REFERENCES "BetaInvitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- #177 invariants: the application (accessRequestTriage.ts) is the only
-- writer of this table and already enforces every rule below; these CHECK
-- constraints exist purely so a bug there can never persist an inconsistent
-- decision-history row (matches the BetaInvitationDeliveryAttempt/
-- FeedbackTriageEvent precedent).

-- 1. Exact previousStatus/nextStatus pairs per eventType. A "blocked" attempt
--    never changes state (previousStatus = nextStatus = PENDING); REOPENED
--    always lands back on PENDING from either terminal state.
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_status_transition_check"
  CHECK (
    ("eventType" = 'NOTE_ADDED' AND "previousStatus" IS NOT NULL AND "nextStatus" = "previousStatus")
    OR ("eventType" = 'CONVERSION_BLOCKED' AND "previousStatus" = 'PENDING' AND "nextStatus" = 'PENDING')
    OR ("eventType" = 'INVITED' AND "previousStatus" = 'PENDING' AND "nextStatus" = 'INVITED')
    OR ("eventType" = 'DECLINED' AND "previousStatus" = 'PENDING' AND "nextStatus" = 'DECLINED')
    OR ("eventType" = 'REOPENED' AND "previousStatus" IN ('DECLINED', 'RESOLVED_EXISTING_ACCESS') AND "nextStatus" = 'PENDING')
    OR ("eventType" = 'RESOLVED_EXISTING_ACCESS' AND "previousStatus" = 'PENDING' AND "nextStatus" = 'RESOLVED_EXISTING_ACCESS')
  );

-- 2. Reason/note payload fields: required-and-bounded for their own
--    eventType, forbidden for every other eventType.
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_noteText_check"
  CHECK (
    CASE WHEN "eventType" = 'NOTE_ADDED'
      THEN "noteText" IS NOT NULL AND char_length("noteText") BETWEEN 1 AND 2000
      ELSE "noteText" IS NULL
    END
  );

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_declineReason_check"
  CHECK (
    CASE WHEN "eventType" = 'DECLINED'
      THEN "declineReason" IS NOT NULL AND char_length("declineReason") BETWEEN 1 AND 500
      ELSE "declineReason" IS NULL
    END
  );

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_resolutionReason_check"
  CHECK (
    CASE WHEN "eventType" = 'RESOLVED_EXISTING_ACCESS'
      THEN "resolutionReason" IS NOT NULL AND char_length("resolutionReason") BETWEEN 1 AND 500
      ELSE "resolutionReason" IS NULL
    END
  );

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_reopenReason_check"
  CHECK (
    CASE WHEN "eventType" = 'REOPENED'
      THEN "reopenReason" IS NOT NULL AND char_length("reopenReason") BETWEEN 1 AND 500
      ELSE "reopenReason" IS NULL
    END
  );

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_betaWave_check"
  CHECK (
    CASE WHEN "eventType" = 'INVITED'
      THEN "betaWave" IS NOT NULL AND char_length("betaWave") BETWEEN 1 AND 80
      ELSE "betaWave" IS NULL
    END
  );

-- 3. blockedReason/blockedConflictType: required together, only for
--    CONVERSION_BLOCKED, and never NONE.
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_blocked_payload_check"
  CHECK (
    CASE WHEN "eventType" = 'CONVERSION_BLOCKED'
      THEN "blockedReason" IS NOT NULL AND char_length("blockedReason") BETWEEN 1 AND 500
        AND "blockedConflictType" IS NOT NULL AND "blockedConflictType" != 'NONE'
      ELSE "blockedReason" IS NULL AND "blockedConflictType" IS NULL
    END
  );

-- 4. linkedInvitationId: set exactly once, at INVITED.
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_linkedInvitationId_check"
  CHECK (
    CASE WHEN "eventType" = 'INVITED'
      THEN "linkedInvitationId" IS NOT NULL
      ELSE "linkedInvitationId" IS NULL
    END
  );

-- 5. conflictInvitationId: only for a blocked ACTIVE_PENDING_INVITATION /
--    ALREADY_ACCEPTED conflict (the invitation the operator should act on
--    instead — resend or view — never a snapshot, since BetaInvitation rows
--    are immutable history and never deleted by cleanup).
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictInvitationId_check"
  CHECK (
    CASE WHEN "eventType" = 'CONVERSION_BLOCKED' AND "blockedConflictType" IN ('ACTIVE_PENDING_INVITATION', 'ALREADY_ACCEPTED')
      THEN "conflictInvitationId" IS NOT NULL
      ELSE "conflictInvitationId" IS NULL
    END
  );

-- 6. conflictParticipantIdSnapshots cardinality: exactly one candidate for a
--    reissue-eligible existing participant; one-or-more for an identity
--    conflict (usually two disagreeing candidates, but a single participant
--    already flagged ambiguous by a prior merge is also a valid ambiguity
--    with only one known id); empty otherwise. cardinality() (not
--    array_length(), which returns NULL — not 0 — for an empty array) is
--    safe here because the column is NOT NULL with a `{}` default.
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictParticipantIdSnapshots_check"
  CHECK (
    CASE
      WHEN "eventType" = 'CONVERSION_BLOCKED' AND "blockedConflictType" = 'EXISTING_PARTICIPANT_REISSUE'
        THEN cardinality("conflictParticipantIdSnapshots") = 1
      WHEN "eventType" = 'CONVERSION_BLOCKED' AND "blockedConflictType" = 'IDENTITY_AMBIGUOUS'
        THEN cardinality("conflictParticipantIdSnapshots") >= 1
      ELSE cardinality("conflictParticipantIdSnapshots") = 0
    END
  );

-- 7. Conflict user/alliance evidence snapshot: required together for
--    RESOLVED_EXISTING_ACCESS (always) and a blocked EXISTING_ALLIANCE_ACCESS
--    conflict; optionally present as a group for NOTE_ADDED (a denied
--    reopen's refreshed "still has access" evidence); forbidden otherwise.
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflict_evidence_required_check"
  CHECK (
    CASE WHEN "eventType" = 'RESOLVED_EXISTING_ACCESS'
      OR ("eventType" = 'CONVERSION_BLOCKED' AND "blockedConflictType" = 'EXISTING_ALLIANCE_ACCESS')
    THEN
      "conflictUserIdSnapshot" IS NOT NULL AND "conflictUserEmail" IS NOT NULL
      AND "conflictUserDisplayName" IS NOT NULL AND "conflictAllianceIdSnapshot" IS NOT NULL
      AND "conflictAllianceName" IS NOT NULL AND "conflictMembershipCount" IS NOT NULL
    ELSE true
    END
  );

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflict_evidence_forbidden_check"
  CHECK (
    CASE WHEN "eventType" NOT IN ('RESOLVED_EXISTING_ACCESS', 'CONVERSION_BLOCKED', 'NOTE_ADDED')
    THEN
      "conflictUserIdSnapshot" IS NULL AND "conflictUserEmail" IS NULL
      AND "conflictUserDisplayName" IS NULL AND "conflictAllianceIdSnapshot" IS NULL
      AND "conflictAllianceName" IS NULL AND "conflictMembershipCount" IS NULL
    ELSE true
    END
  );

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflict_evidence_allornothing_check"
  CHECK (
    (
      ("conflictUserIdSnapshot" IS NOT NULL)::int + ("conflictUserEmail" IS NOT NULL)::int
      + ("conflictUserDisplayName" IS NOT NULL)::int + ("conflictAllianceIdSnapshot" IS NOT NULL)::int
      + ("conflictAllianceName" IS NOT NULL)::int + ("conflictMembershipCount" IS NOT NULL)::int
    ) IN (0, 6)
  );

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictMembershipCount_check"
  CHECK ("conflictMembershipCount" IS NULL OR "conflictMembershipCount" >= 1);

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictUserEmail_length_check"
  CHECK ("conflictUserEmail" IS NULL OR char_length("conflictUserEmail") <= 320);

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictUserDisplayName_length_check"
  CHECK ("conflictUserDisplayName" IS NULL OR char_length("conflictUserDisplayName") <= 200);

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_conflictAllianceName_length_check"
  CHECK ("conflictAllianceName" IS NULL OR char_length("conflictAllianceName") <= 200);

-- 8. actorEmail/currentReason-style bound on the actor snapshot mirrors the
--    FeedbackTriageEvent precedent (actorEmail is NOT NULL already; bound its
--    length defensively since it is never re-validated on read).
ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_actorEmail_length_check"
  CHECK (char_length("actorEmail") <= 320);

ALTER TABLE "AccessRequestTriageEvent" ADD CONSTRAINT "AccessRequestTriageEvent_actorDisplayName_length_check"
  CHECK ("actorDisplayName" IS NULL OR char_length("actorDisplayName") <= 200);

-- 9. AccessRequestTriage projection: mirror the bounds that matter for
--    display/filtering (full validation lives in accessRequestTriage.ts;
--    these are defense-in-depth backstops, same rationale as above).
ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_betaWave_length_check"
  CHECK ("betaWave" IS NULL OR char_length("betaWave") BETWEEN 1 AND 80);

ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_currentReason_length_check"
  CHECK ("currentReason" IS NULL OR char_length("currentReason") BETWEEN 1 AND 500);

ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_conflictMembershipCount_check"
  CHECK ("conflictMembershipCount" IS NULL OR "conflictMembershipCount" >= 1);

ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_conflict_evidence_allornothing_check"
  CHECK (
    (
      ("conflictUserIdSnapshot" IS NOT NULL)::int + ("conflictUserEmail" IS NOT NULL)::int
      + ("conflictUserDisplayName" IS NOT NULL)::int + ("conflictAllianceIdSnapshot" IS NOT NULL)::int
      + ("conflictAllianceName" IS NOT NULL)::int + ("conflictMembershipCount" IS NOT NULL)::int
    ) IN (0, 6)
  );

-- RESOLVED_EXISTING_ACCESS always carries conflict evidence on the
-- projection; every other status leaves it null (cleared on a successful
-- REOPENED transition, since access no longer applies).
ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_resolved_requires_evidence_check"
  CHECK (
    CASE WHEN "status" = 'RESOLVED_EXISTING_ACCESS'
      THEN "conflictUserIdSnapshot" IS NOT NULL
      ELSE true
    END
  );

ALTER TABLE "AccessRequestTriage" ADD CONSTRAINT "AccessRequestTriage_linkedInvitation_status_check"
  CHECK (
    CASE WHEN "status" = 'INVITED'
      THEN "linkedInvitationId" IS NOT NULL
      ELSE "linkedInvitationId" IS NULL
    END
  );
