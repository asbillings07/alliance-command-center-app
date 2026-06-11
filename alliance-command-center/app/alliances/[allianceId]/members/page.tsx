// 1. Verify authenticated user

//2. Verify membership

// 3. Load alliance

// 4. Load members

// 5. Render member list
import { auth } from "@/app/src/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";

type Params = {
    params: Promise<{
        allianceId: string;
    }>
}

export default async function MembersPage({ params }: Params) {
    const { allianceId } = await params;
    const session = await auth();
    if (!session || !session.user?.id) {
        redirect("/login");
    }
    const membership = await prisma.allianceMembership.findUnique({
        where: {
            allianceId_userId: {
                allianceId: allianceId,
                userId: session.user.id,
            }
        }
    });
    if (!membership) {
        redirect("/app");
    }
    const alliance = await prisma.alliance.findUnique({
        where: {
            id: allianceId,
        }
    });
    if (!alliance) {
        redirect("/app");
    }

    const members = await prisma.member.findMany({
        where: {
            allianceId: allianceId,
        }
    });

    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <h1>Members of {alliance.name}</h1>
            <div>Member Count: {members.length}</div>
            <div className="flex flex-col items-center justify-center">
                {members.map((member) => (
                    <div key={member.id} className="flex flex-col items-center justify-center p-5 border-b border-gray-300">
                    <div className="text-lg font-bold">{member.playerName}</div>
                    <div className="text-sm text-gray-500">{member.thp?.toLocaleString()}</div>
                    <div className="text-sm text-gray-500">{member.squadPower?.toLocaleString()}</div>
                    </div>
                ))}
            </div>
        </div>
    );
}