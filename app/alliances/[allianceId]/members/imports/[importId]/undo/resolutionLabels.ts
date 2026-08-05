/**
 * Shared display copy for MemberImportRollbackResultResolution values.
 * Used by both the undo form's live preview (RollbackUndoForm, a Client
 * Component) and the durable "already undone" summary (page.tsx, a Server
 * Component) so the same result never reads differently depending on when
 * it's viewed.
 */
export const ROLLBACK_RESOLUTION_LABELS: Record<string, string> = {
    DELETED: "Delete (undo creation)",
    REVERTED_TO_PRE_IMPORT_STATE: "Revert to pre-import state",
    RETAINED_ARCHIVED: "Retain, archived",
    SKIPPED_CONFLICT: "Skip — conflicting edit since import",
    RETAINED_ACTIVE: "Retain active",
    ARCHIVED_PRESERVING_HISTORY: "Archive, preserving history",
};
