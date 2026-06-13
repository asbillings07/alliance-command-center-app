"use server";
import {
  LeadershipNoteType,
  LeadershipNoteVisibility,
} from "@/app/generated/prisma/client";
import { prisma } from "@/app/src/lib/prisma";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { requireMembershipAccess } from "@/app/src/lib/auth/requireMembershipAccess";
import { revalidatePath } from "next/cache";

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
  const content = formData.get("content") as string;

  if (!content.trim()) {
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
