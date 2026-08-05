// Shared between RollbackUndoForm's live preview (a "use client" component)
// and the durable AlreadyRolledBackSummary (a Server Component in page.tsx)
// so a member's conflict reasons read identically whether the owner is
// deciding what to do right now or reviewing what already happened. Kept as
// a plain, framework-free module — no "use client"/"use server" boundary to
// cross either way.

/** The evidence fields both a live `RollbackPreviewItem` and a persisted
 * `MemberImportRollbackResult` row carry. `memberMissing` is its own field
 * on both sides rather than inferred from everything else being
 * empty/zero — a missing member's evidence *is* all-empty (there's nothing
 * left to read), and collapsing that into "no evidence recorded" would make
 * it the one conflict cause neither the live preview nor the durable view
 * could ever explain. */
export type RollbackEvidence = {
    memberMissing: boolean;
    driftedFields: string[];
    hadLaterImportInvolvement: boolean;
    hadLinkedUser: boolean;
    metricEntryCount: number;
    leadershipNoteCount: number;
    invitationCount: number;
};

/** Naive but not wrong: handles the consonant-plus-"y" pattern (e.g. "metric
 * entry" -> "metric entries") in addition to the plain "add an s" case,
 * since this is the only irregular plural any current caller needs. */
export function pluralize(count: number, noun: string): string {
    if (count === 1) return `1 ${noun}`;
    const lastChar = noun.slice(-1).toLowerCase();
    const precedingChar = noun.slice(-2, -1).toLowerCase();
    const plural =
        lastChar === "y" && precedingChar !== "" && !"aeiou".includes(precedingChar)
            ? `${noun.slice(0, -1)}ies`
            : `${noun}s`;
    return `${count} ${plural}`;
}

/** Human-readable reasons a row conflicted (or, for a fully clean row,
 * none). Never claims more or less than the evidence it's handed —
 * `MemberImportRollbackResult` persists exactly these same fields, so the
 * durable view can render this identically after the fact. */
export function describeRollbackEvidence(evidence: RollbackEvidence): string[] {
    if (evidence.memberMissing) {
        return ["This member no longer exists."];
    }
    const reasons: string[] = [];
    if (evidence.driftedFields.length > 0) {
        reasons.push(`Changed since import: ${evidence.driftedFields.join(", ")}`);
    }
    if (evidence.hadLaterImportInvolvement) {
        // Deliberately non-specific: this covers both a genuinely later
        // import in this same alliance and *any* reference at all from a
        // different alliance's import (see computeImportRollbackPreview's
        // doc comment) — never reveal which import, or that another
        // alliance is involved at all.
        reasons.push("Involved in another import");
    }
    if (evidence.hadLinkedUser) {
        reasons.push("Now linked to a user account");
    }
    if (evidence.metricEntryCount > 0) {
        reasons.push(`${pluralize(evidence.metricEntryCount, "metric entry")} recorded since`);
    }
    if (evidence.leadershipNoteCount > 0) {
        reasons.push(`${pluralize(evidence.leadershipNoteCount, "leadership note")} recorded since`);
    }
    if (evidence.invitationCount > 0) {
        reasons.push(`${pluralize(evidence.invitationCount, "invitation")} issued since`);
    }
    return reasons;
}
