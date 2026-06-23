"use server";
import {
  LeadershipNoteType,
  LeadershipNoteVisibility,
} from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireMembershipAccess } from "@/app/src/lib/auth/requireMembershipAccess";
import { revalidatePath } from "next/cache";
import { requireAuthorAccess } from "@/app/src/lib/auth/requireAuthorAccess";

export async function createLeadershipNote(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const memberId = formData.get("memberId");
  if (typeof memberId !== "string" || !memberId) {
    throw new Error("Member is required");
  }

  const { member } = await requireMembershipAccess(memberId, user.id);
  const authorId = user.id;
  const noteType = formData.get("noteType") as LeadershipNoteType;
  if (!Object.values(LeadershipNoteType).includes(noteType)) {
    throw new Error("Invalid note type");
  }
  const visibility = LeadershipNoteVisibility.LEADERSHIP;
  const rawContent = formData.get("content");
  const content = typeof rawContent === "string" ? rawContent.trim() : "";

  if (!content) {
    throw new Error("Content is required");
  }

  await prisma.leadershipNote.create({
    data: {
      memberId: member.id,
      authorId,
      noteType,
      visibility,
      content,
    },
  });

  revalidatePath(`/alliances/${member.allianceId}/members/${member.id}`);
}

export async function editLeadershipNote(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const noteId = formData.get("noteId");
  const noteType = formData.get("noteType") as LeadershipNoteType;
  const rawContent = formData.get("content");
  const content = typeof rawContent === "string" ? rawContent.trim() : "";

  if (!Object.values(LeadershipNoteType).includes(noteType)) {
    throw new Error("Invalid note type");
  }
  if (typeof noteId !== "string" || !noteId) {
    throw new Error("Note is required");
  }
  if (!content) {
    throw new Error("Content is required");
  }

  const { note, member } = await requireAuthorAccess(noteId, user.id);

  if (!note) {
    throw new Error("Note not found");
  }

  await prisma.leadershipNote.update({
    where: { id: noteId },
    data: { noteType, content },
  });
  revalidatePath(`/alliances/${member.allianceId}/members/${member.id}`);
}

export async function deleteLeadershipNote(formData: FormData): Promise<void> {
  const user = await requireAuth();
  const noteId = formData.get("noteId");
  if (typeof noteId !== "string" || !noteId) {
    throw new Error("Note is required");
  }
  const { note, member } = await requireAuthorAccess(noteId, user.id);
  await prisma.leadershipNote.delete({
    where: { id: note.id },
  });
  revalidatePath(`/alliances/${member.allianceId}/members/${member.id}`);
}
