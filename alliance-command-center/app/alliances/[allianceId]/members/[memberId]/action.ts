"use server";
import {
  LeadershipNoteType,
  LeadershipNoteVisibility,
} from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { revalidatePath } from "next/cache";

export async function createLeadershipNote(formData: FormData): Promise<void> {
  const allianceMemberId = formData.get("memberId");
  if (typeof allianceMemberId !== "string" || !allianceMemberId) {
    throw new Error("Alliance member is required");
  }

  // Load the member to get alliance ID
  const allianceMember = await prisma.allianceMember.findUnique({
    where: { id: allianceMemberId },
  });

  if (!allianceMember) {
    throw new Error("Alliance member not found");
  }

  const auth = await requireAllianceAccess({
    allianceId: allianceMember.allianceId,
    requiredPermission: Permissions.MANAGE_NOTES,
  });

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
      allianceMemberId: allianceMember.id,
      authorId: auth.user.id,
      noteType,
      visibility,
      content,
    },
  });

  revalidatePath(`/alliances/${allianceMember.allianceId}/members/${allianceMember.id}`);
}

export async function editLeadershipNote(formData: FormData): Promise<void> {
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

  // Load the note with its alliance member
  const note = await prisma.leadershipNote.findUnique({
    where: { id: noteId },
    include: { allianceMember: true },
  });

  if (!note) {
    throw new Error("Note not found");
  }

  const auth = await requireAllianceAccess({
    allianceId: note.allianceMember.allianceId,
    requiredPermission: Permissions.MANAGE_NOTES,
  });

  // Verify user is the author
  if (note.authorId !== auth.user.id) {
    throw new Error("You can only edit your own notes");
  }

  await prisma.leadershipNote.update({
    where: { id: noteId },
    data: { noteType, content },
  });

  revalidatePath(`/alliances/${note.allianceMember.allianceId}/members/${note.allianceMember.id}`);
}

export async function deleteLeadershipNote(formData: FormData): Promise<void> {
  const noteId = formData.get("noteId");
  if (typeof noteId !== "string" || !noteId) {
    throw new Error("Note is required");
  }

  // Load the note with its alliance member
  const note = await prisma.leadershipNote.findUnique({
    where: { id: noteId },
    include: { allianceMember: true },
  });

  if (!note) {
    throw new Error("Note not found");
  }

  const auth = await requireAllianceAccess({
    allianceId: note.allianceMember.allianceId,
    requiredPermission: Permissions.MANAGE_NOTES,
  });

  // Verify user is the author
  if (note.authorId !== auth.user.id) {
    throw new Error("You can only delete your own notes");
  }

  await prisma.leadershipNote.delete({
    where: { id: note.id },
  });

  revalidatePath(`/alliances/${note.allianceMember.allianceId}/members/${note.allianceMember.id}`);
}
