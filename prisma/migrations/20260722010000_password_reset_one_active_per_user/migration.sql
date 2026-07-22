-- Enforce "at most one ACTIVE (unused) password reset token per user" at the
-- database level. This makes "only the newest reset link works" a true
-- invariant even under concurrent /forgot-password requests: two requests that
-- race to create a token can no longer both leave an unused row behind — the
-- loser hits this unique violation and its transaction rolls back (the domain
-- layer treats that as a benign "another request already issued the link").
--
-- Expressed as raw SQL because Prisma's schema language cannot model a partial
-- (filtered) unique index; see the note on the PasswordResetToken model.
CREATE UNIQUE INDEX "PasswordResetToken_userId_active_key"
ON "PasswordResetToken" ("userId")
WHERE "usedAt" IS NULL;
