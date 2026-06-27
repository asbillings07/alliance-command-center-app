import { prisma } from "../prisma";
import { notFound } from "next/navigation";

export async function requireMember(memberId: string) {
  const member = await prisma.member.findUnique({
    where: {
      id: memberId,
    },
  });
  if (!member) {
    notFound();
  }
  return member;
}
