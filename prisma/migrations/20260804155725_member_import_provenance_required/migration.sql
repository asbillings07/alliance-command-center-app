-- MemberImport.fileName and MemberImport.sourceSheetName are always set by
-- importMembers() (validated non-empty/length-bounded before the create) --
-- there is no code path that writes a MemberImport without them. The
-- previous migration left both nullable; tighten to NOT NULL so the schema
-- doesn't permit a state the application never produces.
--
-- Safe as a plain ALTER: no MemberImport rows with a null fileName or
-- sourceSheetName can exist, since every row was written by the
-- already-validating action.
ALTER TABLE "MemberImport" ALTER COLUMN "fileName" SET NOT NULL;
ALTER TABLE "MemberImport" ALTER COLUMN "sourceSheetName" SET NOT NULL;
