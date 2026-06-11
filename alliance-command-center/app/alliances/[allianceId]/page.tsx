//Authenticated User

// Valid Membership

// Alliance Loaded

// Render Alliance Page
// Example:
// Alliance: Alliance Name
// Server: Alliance Server Number
// Role: Alliance Role
// Example:
// Alliance: DAY1
// Server: 999
// Role: OWNER
import { auth } from "@/app/src/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";

type Params = {
    params: Promise<{
        allianceId: string;
    }>
}

export default async function AlliancePage({ params }: Params) {
    const { allianceId } = await params;
    console.log("AlliancePage");
    console.log("allianceId", allianceId);
    const session = await auth();
    if (!session || !session.user?.id) {
        redirect("/login");
    }
    if (!allianceId){
        redirect('/app')
    }  

    const membership = await prisma.allianceMembership.findUnique({
        where: {
            allianceId_userId: {
                allianceId: allianceId,
                userId: session.user.id,
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
        </div>
    )
}