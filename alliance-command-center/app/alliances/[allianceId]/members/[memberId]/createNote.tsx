'use client'
import { LeadershipNoteType } from "@/app/generated/prisma/enums";
import { useState } from "react";
import { createLeadershipNote } from "./action";

type CreateNoteProps ={
    memberId: string;
}

export const CreateNote = ({memberId}: CreateNoteProps) => {
    const [isCreatingNote, setIsCreatingNote] = useState(false);
    return !isCreatingNote ? (
        <button onClick={() => setIsCreatingNote(true)} className="bg-blue-500 text-white rounded-md p-2 cursor-pointer">Create Note</button>
    ) : (
        <form className="flex flex-col gap-2" action={createLeadershipNote}>
            <input type="hidden" name="memberId" value={memberId} />
            
            <select name="noteType" defaultValue={LeadershipNoteType.OBSERVATION}>
                <option value={LeadershipNoteType.POSITIVE}>Positive</option>
                <option value={LeadershipNoteType.WARNING}>Warning</option>
                <option value={LeadershipNoteType.OBSERVATION}>Observation</option>
                <option value={LeadershipNoteType.PROMOTION}>Promotion</option>
            </select>
            <textarea rows={5} className="w-full" name="content" placeholder="Note" required />
            <div className="flex gap-2">
            <button type="submit" className="bg-blue-500 text-white rounded-md p-2 cursor-pointer">Save Note</button>
            <button type="button" onClick={() => setIsCreatingNote(false)} className="bg-red-500 text-white rounded-md p-2 cursor-pointer">Cancel</button>
            </div>
        </form>
    )
}