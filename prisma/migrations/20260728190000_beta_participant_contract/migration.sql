-- Deployment B (#174 PR 1b): contract migration — NOT NULL participantId + unique constraints.
--
-- PRECONDITION (manual gate — do not apply until satisfied):
--   1. PR 1a (expand + dual-write) is deployed.
--   2. `npm run beta:backfill-participants -- --execute` has been run in production.
--   3. `npm run beta:validate-participants` exits 0 in production (all four checks zero rows).
--
-- Merging the PR that contains this file does NOT apply it automatically in production;
-- an operator runs `prisma migrate deploy` only after the gate passes.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "BetaInvitation" WHERE "participantId" IS NULL LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'Beta participant contract migration blocked: BetaInvitation.participantId IS NULL rows remain. Run backfill and validation first (#174 PR 1b gate).';
  END IF;

  IF EXISTS (
    SELECT p.id
    FROM "BetaParticipant" p
    JOIN "BetaInvitation" bi ON bi."participantId" = p.id
    WHERE p."identityAmbiguous" = false
      AND bi."acceptedAt" IS NOT NULL
      AND bi."acceptedByUserId" IS NOT NULL
    GROUP BY p.id
    HAVING COUNT(DISTINCT bi."acceptedByUserId") > 1
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'Beta participant contract migration blocked: unflagged participant with multiple distinct accepted userIds. Run validation first (#174 PR 1b gate).';
  END IF;

  IF EXISTS (
    SELECT "userId"
    FROM "BetaParticipant"
    WHERE "userId" IS NOT NULL
    GROUP BY "userId"
    HAVING COUNT(*) > 1
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'Beta participant contract migration blocked: colliding BetaParticipant.userId values. Run validation first (#174 PR 1b gate).';
  END IF;

  IF EXISTS (
    SELECT p.id
    FROM "BetaParticipant" p
    LEFT JOIN "BetaInvitation" bi ON bi."participantId" = p.id
    WHERE bi.id IS NULL
    LIMIT 1
  ) THEN
    RAISE EXCEPTION
      'Beta participant contract migration blocked: orphaned BetaParticipant rows exist. Run validation first (#174 PR 1b gate).';
  END IF;
END $$;

-- CreateIndex: BetaParticipant.userId unique (nullable unique — multiple NULL allowed)
CREATE UNIQUE INDEX "BetaParticipant_userId_key" ON "BetaParticipant"("userId");

-- CreateIndex: BetaInvitation.reissuedFromInvitationId unique
CREATE UNIQUE INDEX "BetaInvitation_reissuedFromInvitationId_key" ON "BetaInvitation"("reissuedFromInvitationId");

-- AlterTable: participantId NOT NULL
ALTER TABLE "BetaInvitation" ALTER COLUMN "participantId" SET NOT NULL;
