// 1. Verify authenticated user

//2. Verify membership

// 3. Load alliance

// 4. Load members

// 5. Render member list
import { auth } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import Link from "next/link";
import { formatPower } from "@/app/src/lib/formatPower";
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
        },
        orderBy: {
            playerName: "asc",
        },
    });

    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <h1>Members of {alliance.name}</h1>
            <div>Member Count: {members.length}</div>
            <Link
                href={`/alliances/${allianceId}/members/import`}
                className="mt-4 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
                Import Roster
            </Link>
            <div className="flex flex-col items-center justify-center mt-4">
                {members.map((member) => (
                    <Link href={`/alliances/${allianceId}/members/${member.id}`} key={member.id} className="flex flex-col items-center justify-center p-5 border border-gray-300 rounded-md cursor-pointer m-5">
                    <div className="text-lg font-bold">{member.playerName}</div>
                    <div className="text-sm text-gray-500">THP: {member.thp == null ? "—" : formatPower(member.thp)}</div>
                    <div className="text-sm text-gray-500">Top Squad: {member.squadPower == null ? "—" : formatPower(member.squadPower)}</div>
                    </Link>
                ))}
            </div>
        </div>
    );
}