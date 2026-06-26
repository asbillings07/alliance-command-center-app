import { redirect } from "next/navigation";
import { prisma } from "../prisma";
export const requireAuthorAccess = async (noteId: string, userId: string) => {
  const note = await prisma.leadershipNote.findUnique({
    where: { id: noteId },
    include: {
      member: true,
    },
  });
  if (!note) {
    throw new Error("Note not found");
  }
  if (note.authorId !== userId) {
    redirect("/app");
  }
  return { note, member: note.member };
};
