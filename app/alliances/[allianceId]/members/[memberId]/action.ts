"use server";
import {
  LeadershipNoteType,
  LeadershipNoteVisibility,
} from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";
import { requireAllianceAccess } from "@/app/src/lib/auth/requireAllianceAccess";
import { Permissions } from "@/app/src/lib/auth/permissions";
import { revalidatePath } from "next/cache";

export type NoteActionResult = {
  error?: string;
  success?: boolean;
};

export async function createLeadershipNote(
  formData: FormData
): Promise<NoteActionResult> {
  const allianceMemberId = formData.get("memberId");
  if (typeof allianceMemberId !== "string" || !allianceMemberId) {
    return { error: "Alliance member is required" };
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    return { error: "Alliance is required" };
  }

  // Authorize before any DB lookup to prevent ID enumeration
  const auth = await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.MANAGE_NOTES,
  });

  // Query scoped by both id and allianceId for safety
  const allianceMember = await prisma.allianceMember.findFirst({
    where: { id: allianceMemberId, allianceId },
  });

  if (!allianceMember) {
    return { error: "Alliance member not found" };
  }

  const noteType = formData.get("noteType") as LeadershipNoteType;
  if (!Object.values(LeadershipNoteType).includes(noteType)) {
    return { error: "Invalid note type" };
  }
  const visibility = LeadershipNoteVisibility.LEADERSHIP;
  const rawContent = formData.get("content");
  const content = typeof rawContent === "string" ? rawContent.trim() : "";

  if (!content) {
    return { error: "Content is required" };
  }

  try {
    await prisma.leadershipNote.create({
      data: {
        allianceMemberId: allianceMember.id,
        authorId: auth.user.id,
        noteType,
        visibility,
        content,
      },
    });
  } catch (err) {
    console.error("Failed to create note:", err);
    return { error: "Failed to save note" };
  }

  revalidatePath(
    `/alliances/${allianceMember.allianceId}/members/${allianceMember.id}`
  );
  return { success: true };
}

export async function editLeadershipNote(
  formData: FormData
): Promise<NoteActionResult> {
  const noteId = formData.get("noteId");
  const noteType = formData.get("noteType") as LeadershipNoteType;
  const rawContent = formData.get("content");
  const content = typeof rawContent === "string" ? rawContent.trim() : "";

  if (!Object.values(LeadershipNoteType).includes(noteType)) {
    return { error: "Invalid note type" };
  }
  if (typeof noteId !== "string" || !noteId) {
    return { error: "Note is required" };
  }
  if (!content) {
    return { error: "Content is required" };
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    return { error: "Alliance is required" };
  }

  // Authorize before any DB lookup to prevent ID enumeration
  const auth = await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.MANAGE_NOTES,
  });

  // Load the note with its alliance member, scoped by allianceId
  const note = await prisma.leadershipNote.findFirst({
    where: {
      id: noteId,
      allianceMember: { allianceId },
    },
    include: { allianceMember: true },
  });

  if (!note) {
    return { error: "Note not found" };
  }

  // Verify user is the author
  if (note.authorId !== auth.user.id) {
    return { error: "You can only edit your own notes" };
  }

  try {
    await prisma.leadershipNote.update({
      where: { id: noteId },
      data: { noteType, content },
    });
  } catch (err) {
    console.error("Failed to update note:", err);
    return { error: "Failed to update note" };
  }

  revalidatePath(`/alliances/${allianceId}/members/${note.allianceMemberId}`);
  return { success: true };
}

export async function deleteLeadershipNote(formData: FormData): Promise<void> {
  const noteId = formData.get("noteId");
  if (typeof noteId !== "string" || !noteId) {
    throw new Error("Note is required");
  }

  const allianceId = formData.get("allianceId");
  if (typeof allianceId !== "string" || !allianceId) {
    throw new Error("Alliance is required");
  }

  // Authorize before any DB lookup to prevent ID enumeration
  const auth = await requireAllianceAccess({
    allianceId,
    requiredPermission: Permissions.MANAGE_NOTES,
  });

  // Load the note with its alliance member, scoped by allianceId
  const note = await prisma.leadershipNote.findFirst({
    where: {
      id: noteId,
      allianceMember: { allianceId },
    },
    include: { allianceMember: true },
  });

  if (!note) {
    throw new Error("Note not found");
  }

  // Verify user is the author
  if (note.authorId !== auth.user.id) {
    throw new Error("You can only delete your own notes");
  }

  await prisma.leadershipNote.delete({
    where: { id: note.id },
  });

  revalidatePath(`/alliances/${allianceId}/members/${note.allianceMemberId}`);
}
