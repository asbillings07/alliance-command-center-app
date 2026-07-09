//Authenticated User

// Valid Membership

// Alliance Loaded

// Establish alliance context
// Provide navigation to modules

import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import Link from "next/link";

type Params = {
    params: Promise<{
        allianceId: string;
    }>
}

export default async function AlliancePage({ params }: Params) {
    const { allianceId } = await params;
    const user = await requireAuth();
    if (!allianceId){
        redirect('/app')
    }

    const membership = await prisma.allianceMembership.findUnique({
        where: {
            allianceId_userId: {
                allianceId: allianceId,
                userId: user.id,
            }
        }
    });
    const alliance = await prisma.alliance.findUnique({
        where: {
            id: allianceId,
        }
    })
    if (!membership || !alliance) {
        redirect('/app')
    }


    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <h1 className="text-2xl font-bold">Alliance: {alliance.name}</h1>
            <p className="text-lg">Server: {alliance.server}</p>
            <p className="text-lg">Role: {membership.role}</p>

        <div className="flex flex-col items-center justify-center gap-4">
            <h2>Modules:</h2>
            <Link href={`/alliances/${allianceId}/members`} className="bg-blue-500 text-white rounded-md p-2 cursor-pointer">Members</Link>
            <Link href={`/alliances/${allianceId}/metrics`} className="bg-blue-500 text-white rounded-md p-2 cursor-pointer">Metrics Library</Link>
            <Link href={`/alliances/${allianceId}/periods`} className="bg-blue-500 text-white rounded-md p-2 cursor-pointer">Evaluation Periods</Link>
            {(membership.role === "OWNER" || membership.role === "ADMIN") && (
                <Link href={`/alliances/${allianceId}/settings/invitations`} className="bg-blue-500 text-white rounded-md p-2 cursor-pointer">Leadership Team</Link>
            )}
            <button className="bg-blue-500 text-white rounded-md p-2" disabled>Notes (coming soon)</button>
            <button className="bg-blue-500 text-white rounded-md p-2" disabled>Recruiting (coming soon)</button>
        </div>
        </div>
    )
}