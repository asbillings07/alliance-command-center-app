-- The `MemberImportRollbackResult.driftedFields` column was created
-- nullable (Prisma's migration diffing doesn't add NOT NULL to scalar-list
-- columns on its own), even though the Prisma schema declares it as a
-- non-optional `String[] @default([])`. Every consumer (the durable
-- summary view, describeRollbackEvidence, etc.) treats this as an always-
-- present array and calls array methods on it directly, so a raw or future
-- write that leaves it NULL would produce audit data Prisma Client cannot
-- safely represent or render.
--
-- Backfill defensively before tightening the constraint: no row should
-- currently have NULL here (every application write already supplies `[]`
-- via Prisma), but a migration must not assume that rather than enforce it.
UPDATE "MemberImportRollbackResult" SET "driftedFields" = ARRAY[]::TEXT[] WHERE "driftedFields" IS NULL;

ALTER TABLE "MemberImportRollbackResult" ALTER COLUMN "driftedFields" SET NOT NULL;
