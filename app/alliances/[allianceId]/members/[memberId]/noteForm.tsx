"use client";

import { useState, useTransition, useRef } from "react";
import { LeadershipNoteType } from "@/app/generated/prisma/enums";
import { createLeadershipNote, editLeadershipNote } from "./action";
import { Card, Button, Label, Select, Textarea } from "@/app/src/components";

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
    <Card>
      <Card.Body>
        <form
          ref={formRef}
          className="flex flex-col gap-4"
          onSubmit={handleSubmit}
        >
          <input type="hidden" name="allianceId" value={allianceId} />
          <input type="hidden" name="memberId" value={memberId} />
          {mode === "edit" && noteId && (
            <input type="hidden" name="noteId" value={noteId} />
          )}

          {error && (
            <div className="p-3 bg-danger/10 border border-danger rounded-md text-sm text-danger">
              {error}
            </div>
          )}

          <div>
            <Label htmlFor="noteType">Note Type</Label>
            <Select
              id="noteType"
              name="noteType"
              defaultValue={noteType}
              disabled={isPending}
            >
              <option value={LeadershipNoteType.POSITIVE}>Positive</option>
              <option value={LeadershipNoteType.WARNING}>Warning</option>
              <option value={LeadershipNoteType.OBSERVATION}>Observation</option>
              <option value={LeadershipNoteType.PROMOTION}>Promotion</option>
            </Select>
          </div>

          <div>
            <Label htmlFor="content">Note Content</Label>
            <Textarea
              id="content"
              name="content"
              rows={4}
              placeholder="Enter your note..."
              defaultValue={content}
              disabled={isPending}
              required
            />
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="secondary"
              onClick={onCancel}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={isPending}
            >
              {isPending ? pendingLabel : submitLabel}
            </Button>
          </div>
        </form>
      </Card.Body>
    </Card>
  );
}