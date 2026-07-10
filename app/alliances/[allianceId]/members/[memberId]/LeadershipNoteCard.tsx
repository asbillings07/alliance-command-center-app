'use client'
import { LeadershipNoteType } from "@/app/generated/prisma/enums";
import { useState } from "react";
import { NoteForm } from "./noteForm";
import { deleteLeadershipNote } from "./action";
import { Card, Badge, Button } from "@/app/src/components";

type NoteData = {
    id: string;
    content: string;
    noteKey: string;
    noteType: LeadershipNoteType;
    authorName: string;
    createdAt: string;
    canEdit: boolean;
};

type LeadershipNoteCardProps = {
    allianceId: string;
    memberId: string;
    mode: "create" | "view";
    note?: NoteData;
};

const NOTE_TYPE_VARIANTS: Record<LeadershipNoteType, { label: string; variant: "success" | "warning" | "info" | "neutral" }> = {
    [LeadershipNoteType.POSITIVE]: { label: "Positive", variant: "success" },
    [LeadershipNoteType.WARNING]: { label: "Warning", variant: "warning" },
    [LeadershipNoteType.OBSERVATION]: { label: "Observation", variant: "info" },
    [LeadershipNoteType.PROMOTION]: { label: "Promotion", variant: "neutral" }
};

export function LeadershipNoteCard({ allianceId, memberId, mode, note }: LeadershipNoteCardProps) {
    const [cardState, setCardState] = useState<"closed" | "form" | "view">(
        mode === "create" ? "closed" : "view"
    );

    if (mode === "create") {
        if (cardState === "closed") {
            return (
                <div className="w-full">
                    <button
                        type="button"
                        onClick={() => setCardState("form")}
                        className="w-full rounded-md border-2 border-dashed border-primary p-4 text-secondary hover:border-accent-primary hover:text-accent-primary cursor-pointer transition-colors"
                    >
                        + Add Leadership Note
                    </button>
                </div>
            );
        }
        
        return (
            <div className="w-full">
                <NoteForm
                    allianceId={allianceId}
                    memberId={memberId}
                    mode="create"
                    content=""
                    noteType={LeadershipNoteType.OBSERVATION}
                    onCancel={() => setCardState("closed")}
                />
            </div>
        );
    }

    if (!note) return null;

    const typeInfo = NOTE_TYPE_VARIANTS[note.noteType] || NOTE_TYPE_VARIANTS[LeadershipNoteType.OBSERVATION];

    if (cardState === "form" && note.canEdit) {
        return (
            <NoteForm
                key={note.noteKey}
                allianceId={allianceId}
                memberId={memberId}
                mode="edit"
                noteId={note.id}
                content={note.content}
                noteType={note.noteType}
                onCancel={() => setCardState("view")}
            />
        );
    }

    return (
        <Card>
            <Card.Body>
                <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                        <div className="flex items-center gap-2 mb-2">
                            <Badge variant={typeInfo.variant} size="sm">
                                {typeInfo.label}
                            </Badge>
                            <span className="text-sm text-secondary">
                                by {note.authorName}
                            </span>
                            <span className="text-sm text-tertiary">
                                • {note.createdAt}
                            </span>
                        </div>
                        <p className="text-primary whitespace-pre-wrap">{note.content}</p>
                    </div>
                    {note.canEdit && (
                        <div className="flex items-center gap-2">
                            <Button
                                variant="link"
                                size="sm"
                                onClick={() => setCardState("form")}
                            >
                                Edit
                            </Button>
                            <form action={deleteLeadershipNote}>
                                <input type="hidden" name="noteId" value={note.id} />
                                <input type="hidden" name="allianceId" value={allianceId} />
                                <Button variant="danger-link" size="sm" type="submit">
                                    Delete
                                </Button>
                            </form>
                        </div>
                    )}
                </div>
            </Card.Body>
        </Card>
    );
}


