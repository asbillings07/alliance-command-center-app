import { auth } from "@/app/src/auth";  
import { redirect, notFound } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { formatPower } from "@/app/src/lib/formatPower";

type Params = {
    params: Promise<{
        allianceId: string;
        memberId: string;
    }>
}

export default async function MemberPage({ params }: Params) {
    const { allianceId, memberId } = await params;
    const session = await auth();
    if (!session || !session.user?.id) {
        redirect("/login");
    }
    const membership = await prisma.allianceMembership.findUnique({
      where: {
        allianceId_userId: {
          allianceId,
          userId: session.user.id,
        },
      },
    })
    if (!membership) {
        notFound();
    }

    const member = await prisma.member.findUnique({
        where: {
            id: memberId,
        },
    });
    if (!member || member.allianceId !== allianceId) {
        notFound();
    }

return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 p-8">
        <section className="flex flex-col items-center justify-center">
            <div className="text-2xl font-bold p-5">Member Overview</div>
            <h1 className="text-xl font-bold">Member: {member.playerName}</h1>
            <div className="text-sm text-gray-500">THP: {member.thp == null ? "—" : formatPower(member.thp)}</div>
            <div className="text-sm text-gray-500">Top Squad: {member.squadPower == null ? "—" : formatPower(member.squadPower)}</div>
        </section>
        <section className="flex flex-col items-center justify-center">
            <div className="text-2xl font-bold p-5">Leadership Notes (Coming soon)</div>
        </section>
        <section className="flex flex-col items-center justify-center">
            <div className="text-2xl font-bold p-5">Member Participation Metrics (Coming soon)</div>
        </section>
    </div>
)
}
