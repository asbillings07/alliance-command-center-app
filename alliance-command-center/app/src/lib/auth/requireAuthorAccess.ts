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
    throw new Error("Unauthorized");
  }
  return { note, member: note.member };
};
