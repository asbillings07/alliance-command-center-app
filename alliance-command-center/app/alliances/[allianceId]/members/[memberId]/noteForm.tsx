'use client'
import { LeadershipNoteType } from "@/app/generated/prisma/enums";
import { createLeadershipNote, editLeadershipNote } from "./action";

type NoteFormProps = {
    memberId: string;
    mode: "create" | "edit";
    noteId?: string;
    content: string;
    noteType: LeadershipNoteType;
    onCancel: () => void;
};

export function NoteForm({
    memberId,
    mode,
    noteId,
    content = "",
    noteType = LeadershipNoteType.OBSERVATION,
    onCancel,
}: NoteFormProps) {
    const action = mode === "create" ? createLeadershipNote : editLeadershipNote;
    const submitLabel = mode === "create" ? "Save Note" : "Update Note";

    return (
        <form className="w-full rounded-md border p-4 shadow-sm flex flex-col gap-3" action={action}>
            <input type="hidden" name="memberId" value={memberId} />
            {mode === "edit" && noteId && <input type="hidden" name="noteId" value={noteId} />}

            <div>
                <label htmlFor="noteType" className="block text-sm font-medium text-gray-700 mb-1">
                    Note Type
                </label>
                <select
                    id="noteType"
                    name="noteType"
                    defaultValue={noteType}
                    className="w-full rounded-md border border-gray-300 p-2"
                >
                    <option value={LeadershipNoteType.POSITIVE}>Positive</option>
                    <option value={LeadershipNoteType.WARNING}>Warning</option>
                    <option value={LeadershipNoteType.OBSERVATION}>Observation</option>
                    <option value={LeadershipNoteType.PROMOTION}>Promotion</option>
                </select>
            </div>

            <div>
                <label htmlFor="content" className="block text-sm font-medium text-gray-700 mb-1">
                    Note Content
                </label>
                <textarea
                    id="content"
                    name="content"
                    rows={4}
                    className="w-full rounded-md border border-gray-300 p-2"
                    placeholder="Enter your note..."
                    defaultValue={content}
                    required
                />
            </div>

            <div className="flex gap-2 justify-end">
                <button
                    type="button"
                    onClick={onCancel}
                    className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer"
                >
                    Cancel
                </button>
                <button
                    type="submit"
                    className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer"
                >
                    {submitLabel}
                </button>
            </div>
        </form>
    );
}