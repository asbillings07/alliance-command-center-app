import { prisma } from "../prisma";

export async function requireMember(memberId: string) {
  const member = await prisma.member.findFirst({
    where: {
      id: memberId,
    },
  });
  if (!member) {
    throw new Error("Member not found");
  }
  return member;
}
