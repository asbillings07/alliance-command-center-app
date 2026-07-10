"use client";

import { useState, useTransition, useRef } from "react";
import { LeadershipNoteType } from "@/app/generated/prisma/enums";
import { createLeadershipNote, editLeadershipNote } from "./action";

type NoteFormProps = {
  allianceId: string;
  memberId: string;
  mode: "create" | "edit";
  noteId?: string;
  content: string;
  noteType: LeadershipNoteType;
  onCancel: () => void;
};

export function NoteForm({
  allianceId,
  memberId,
  mode,
  noteId,
  content = "",
  noteType = LeadershipNoteType.OBSERVATION,
  onCancel,
}: NoteFormProps) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submitLabel = mode === "create" ? "Save Note" : "Update Note";
  const pendingLabel = mode === "create" ? "Saving..." : "Updating...";

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formRef.current) return;

    setError(null);
    const formData = new FormData(formRef.current);

    startTransition(async () => {
      const action =
        mode === "create" ? createLeadershipNote : editLeadershipNote;
      const result = await action(formData);

      if (result.error) {
        setError(result.error);
      } else {
        onCancel();
      }
    });
  };

  return (
    <form
      ref={formRef}
      className="w-full rounded-md border p-4 shadow-sm flex flex-col gap-3"
      onSubmit={handleSubmit}
    >
      <input type="hidden" name="allianceId" value={allianceId} />
      <input type="hidden" name="memberId" value={memberId} />
      {mode === "edit" && noteId && (
        <input type="hidden" name="noteId" value={noteId} />
      )}

      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-md text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label
          htmlFor="noteType"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Note Type
        </label>
        <select
          id="noteType"
          name="noteType"
          defaultValue={noteType}
          disabled={isPending}
          className="w-full rounded-md border border-gray-300 p-2 disabled:bg-gray-100"
        >
          <option value={LeadershipNoteType.POSITIVE}>Positive</option>
          <option value={LeadershipNoteType.WARNING}>Warning</option>
          <option value={LeadershipNoteType.OBSERVATION}>Observation</option>
          <option value={LeadershipNoteType.PROMOTION}>Promotion</option>
        </select>
      </div>

      <div>
        <label
          htmlFor="content"
          className="block text-sm font-medium text-gray-700 mb-1"
        >
          Note Content
        </label>
        <textarea
          id="content"
          name="content"
          rows={4}
          className="w-full rounded-md border border-gray-300 p-2 disabled:bg-gray-100"
          placeholder="Enter your note..."
          defaultValue={content}
          disabled={isPending}
          required
        />
      </div>

      <div className="flex gap-2 justify-end">
        <button
          type="button"
          onClick={onCancel}
          disabled={isPending}
          className="px-4 py-2 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-2 rounded-md bg-blue-500 text-white hover:bg-blue-600 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isPending ? pendingLabel : submitLabel}
        </button>
      </div>
    </form>
  );
}