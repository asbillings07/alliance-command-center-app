"use server";
import {
  LeadershipNoteType,
  LeadershipNoteVisibility,
} from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireAllianceMemberAccess } from "@/app/src/lib/auth/requireMembershipAccess";
import { requireLeadershipAccess } from "@/app/src/lib/auth/requireLeadershipAccess";
import { revalidatePath } from "next/cache";
import { requireAuthorAccess } from "@/app/src/lib/auth/requireAuthorAccess";

export async function createLeadershipNote(formData: FormData): Promise<void> {
  const user = await requireAuth();

  const allianceMemberId = formData.get("memberId");
  if (typeof allianceMemberId !== "string" || !allianceMemberId) {
    throw new Error("Alliance member is required");
  }

  const { allianceMember } = await requireAllianceMemberAccess(allianceMemberId, user.id);
  
  // Verify user has leadership role (not just VIEWER)
  await requireLeadershipAccess(allianceMember.allianceId, user.id);
  
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
      allianceMemberId: allianceMember.id,
      authorId,
      noteType,
      visibility,
      content,
    },
  });

  revalidatePath(`/alliances/${allianceMember.allianceId}/members/${allianceMember.id}`);
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

  const { allianceMember } = await requireAuthorAccess(noteId, user.id);

  await prisma.leadershipNote.update({
    where: { id: noteId },
    data: { noteType, content },
  });
  revalidatePath(`/alliances/${allianceMember.allianceId}/members/${allianceMember.id}`);
}

export async function deleteLeadershipNote(formData: FormData): Promise<void> {
  const user = await requireAuth();
  const noteId = formData.get("noteId");
  if (typeof noteId !== "string" || !noteId) {
    throw new Error("Note is required");
  }
  const { note, allianceMember } = await requireAuthorAccess(noteId, user.id);
  await prisma.leadershipNote.delete({
    where: { id: note.id },
  });
  revalidatePath(`/alliances/${allianceMember.allianceId}/members/${allianceMember.id}`);
}
