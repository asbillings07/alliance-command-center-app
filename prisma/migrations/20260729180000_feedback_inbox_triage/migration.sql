-- Feedback inbox triage schema (#176 PR 1).
-- submitter snapshot backfill runs while userId is still required + RESTRICT.

-- 1. Add submitter snapshot columns as nullable first.
ALTER TABLE "Feedback" ADD COLUMN "submitterEmail" TEXT;
ALTER TABLE "Feedback" ADD COLUMN "submitterDisplayName" TEXT;

-- 2. Backfill from live User rows (userId still required at this point).
UPDATE "Feedback" f
SET
  "submitterEmail" = u."email",
  "submitterDisplayName" = u."displayName"
FROM "User" u
WHERE u."id" = f."userId";

-- 3. submitterEmail/submitterDisplayName stay nullable at the DB layer so
--    pre-cutover app instances (old INSERT shape omitting these columns)
--    keep working during rolling deploy. New code always populates them;
--    the read path coalesces snapshot → live User → "Unknown submitter".

-- 4. Relax userId FK: drop RESTRICT, make nullable, re-add with SetNull.
ALTER TABLE "Feedback" DROP CONSTRAINT "Feedback_userId_fkey";
ALTER TABLE "Feedback" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Feedback" ADD CONSTRAINT "Feedback_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 5. Alliance context (nullable, indexed — backfill via script).
ALTER TABLE "Feedback" ADD COLUMN "allianceId" TEXT;
CREATE INDEX "Feedback_allianceId_idx" ON "Feedback"("allianceId");

-- 6. New triage tables and enum.
CREATE TYPE "FeedbackTriageStatus" AS ENUM ('NEW', 'TRIAGED', 'PLANNED', 'RESOLVED', 'DISMISSED');

CREATE TABLE "FeedbackTriage" (
    "feedbackId" TEXT NOT NULL,
    "status" "FeedbackTriageStatus" NOT NULL DEFAULT 'NEW',
    "needsResponse" BOOLEAN NOT NULL DEFAULT true,
    "githubIssueUrl" TEXT,
    "stateRevision" INTEGER NOT NULL DEFAULT 0,
    "lastEventAt" TIMESTAMP(3),
    "lastStateChangeAt" TIMESTAMP(3),
    "lastStateChangeActorEmail" TEXT,
    "lastStateChangeActorDisplayName" TEXT,

    CONSTRAINT "FeedbackTriage_pkey" PRIMARY KEY ("feedbackId")
);

CREATE TABLE "FeedbackTriageEvent" (
    "id" TEXT NOT NULL,
    "feedbackId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT NOT NULL,
    "actorDisplayName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "statusChangedTo" "FeedbackTriageStatus",
    "noteText" TEXT,
    "needsResponseChangedTo" BOOLEAN,
    "githubIssueUrlChanged" BOOLEAN NOT NULL DEFAULT false,
    "githubIssueUrlChangedTo" TEXT,

    CONSTRAINT "FeedbackTriageEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FeedbackTriage_status_idx" ON "FeedbackTriage"("status");
CREATE INDEX "FeedbackTriage_needsResponse_idx" ON "FeedbackTriage"("needsResponse");
CREATE INDEX "FeedbackTriageEvent_feedbackId_createdAt_id_idx" ON "FeedbackTriageEvent"("feedbackId", "createdAt", "id");
CREATE INDEX "FeedbackTriageEvent_actorUserId_idx" ON "FeedbackTriageEvent"("actorUserId");

ALTER TABLE "FeedbackTriage" ADD CONSTRAINT "FeedbackTriage_feedbackId_fkey"
  FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackTriageEvent" ADD CONSTRAINT "FeedbackTriageEvent_feedbackId_fkey"
  FOREIGN KEY ("feedbackId") REFERENCES "Feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "FeedbackTriageEvent" ADD CONSTRAINT "FeedbackTriageEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 7. CHECK constraints (decisions 7–8).
ALTER TABLE "FeedbackTriageEvent" ADD CONSTRAINT "FeedbackTriageEvent_at_least_one_change_check"
  CHECK (
    "statusChangedTo" IS NOT NULL
    OR "noteText" IS NOT NULL
    OR "needsResponseChangedTo" IS NOT NULL
    OR "githubIssueUrlChanged" = true
  );

ALTER TABLE "FeedbackTriageEvent" ADD CONSTRAINT "FeedbackTriageEvent_github_flag_value_check"
  CHECK (
    NOT ("githubIssueUrlChangedTo" IS NOT NULL AND "githubIssueUrlChanged" = false)
  );
