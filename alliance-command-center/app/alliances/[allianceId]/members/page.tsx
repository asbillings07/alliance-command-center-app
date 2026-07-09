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

    const allianceMembers = await prisma.allianceMember.findMany({
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
            <div>Member Count: {allianceMembers.length}</div>
            <Link
                href={`/alliances/${allianceId}/members/import`}
                className="mt-4 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700"
            >
                Import Roster
            </Link>
            <div className="flex flex-col items-center justify-center mt-4">
                {allianceMembers.map((allianceMember) => (
                    <Link href={`/alliances/${allianceId}/members/${allianceMember.id}`} key={allianceMember.id} className="flex flex-col items-center justify-center p-5 border border-gray-300 rounded-md cursor-pointer m-5">
                    <div className="text-lg font-bold">{allianceMember.playerName}</div>
                    <div className="text-sm text-gray-500">THP: {allianceMember.thp == null ? "—" : formatPower(allianceMember.thp)}</div>
                    <div className="text-sm text-gray-500">Top Squad: {allianceMember.squadPower == null ? "—" : formatPower(allianceMember.squadPower)}</div>
                    </Link>
                ))}
            </div>
        </div>
    );
}