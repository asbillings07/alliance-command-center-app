'use client'
import { LeadershipNoteType } from "@/app/generated/prisma/enums";
import { useState } from "react";
import { NoteForm } from "./noteForm";
import { deleteLeadershipNote } from "./action";

type NoteData = {
    id: string;
    content: string;
    noteKey: string;
    noteType: LeadershipNoteType;
    authorName: string;
    createdAt: string;
    isAuthor: boolean;
};

type LeadershipNoteCardProps = {
    allianceId: string;
    memberId: string;
    mode: "create" | "view";
    note?: NoteData;
};

const NOTE_TYPE_LABELS: Record<LeadershipNoteType, { label: string; color: string }> = {
    [LeadershipNoteType.POSITIVE]: { label: "Positive", color: "bg-green-100 text-green-800" },
    [LeadershipNoteType.WARNING]: { label: "Warning", color: "bg-yellow-100 text-yellow-800" },
    [LeadershipNoteType.OBSERVATION]: { label: "Observation", color: "bg-blue-100 text-blue-800" },
    [LeadershipNoteType.PROMOTION]: { label: "Promotion", color: "bg-purple-100 text-purple-800" }
};

export function LeadershipNoteCard({ allianceId, memberId, mode, note }: LeadershipNoteCardProps) {
    // Single state: "closed" (button only), "form" (showing form), or "view" (showing note)
    const [cardState, setCardState] = useState<"closed" | "form" | "view">(
        mode === "create" ? "closed" : "view"
    );

    // CREATE MODE: Show button or create form
    if (mode === "create") {
        if (cardState === "closed") {
            return (
                <div className="w-full">
                    <button
                        type="button"
                        onClick={() => setCardState("form")}
                        className="w-full rounded-md border-2 border-dashed border-gray-300 p-4 text-gray-500 hover:border-blue-400 hover:text-blue-500 cursor-pointer"
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

    // VIEW MODE: Need note data
    if (!note) return null;

    const typeInfo = NOTE_TYPE_LABELS[note.noteType] || NOTE_TYPE_LABELS[LeadershipNoteType.OBSERVATION];

    // VIEW MODE - EDITING: Show edit form
    if (cardState === "form" && note.isAuthor) {
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

    // VIEW MODE - VIEWING: Show the note
    return (
        <div className="w-full rounded-md border p-4 shadow-sm">
            <div className="flex items-start justify-between gap-4">
                <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                        <span className={`px-2 py-1 rounded text-xs font-medium ${typeInfo.color}`}>
                            {typeInfo.label}
                        </span>
                        <span className="text-sm text-gray-500">
                            by {note.authorName}
                        </span>
                        <span className="text-sm text-gray-400">
                            • {note.createdAt}
                        </span>
                    </div>
                    <p className="text-gray-700 whitespace-pre-wrap">{note.content}</p>
                </div>
                {note.isAuthor && (
                    <div className="flex items-center gap-2">
                        <button
                            type="button"
                            onClick={() => setCardState("form")}
                            className="text-sm text-blue-500 hover:text-blue-700 cursor-pointer"
                        >
                            Edit
                        </button>
                        <form action={deleteLeadershipNote}>
                            <input type="hidden" name="noteId" value={note.id} />
                            <input type="hidden" name="allianceId" value={allianceId} />
                            <button type="submit" className="text-sm text-red-500 hover:text-red-700 cursor-pointer">Delete</button>
                        </form>
                    </div>
                )}
            </div>
        </div>
    );
}


