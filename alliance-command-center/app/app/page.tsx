import { auth } from "@/app/src/auth";
import { redirect } from "next/navigation";
import { prisma } from "@/app/src/lib/prisma";

export default async function AppPage() {
    // get session 
    const session = await auth();
    // check if session is valid
    if (!session || !session.user?.id) {
        redirect("/login");
    }
    // Does this user have any memberships?
    const memberships = await prisma.allianceMembership.findMany({
        where: {
            userId: session.user.id,
        },
        select: {
            allianceId: true,
        },
        take: 2,
    });

    if (memberships.length === 0) {
        // redirect to onboarding page
        redirect("/onboarding");
    }
    if (memberships.length === 1) {
        redirect(`/alliances/${memberships[0].allianceId}`);
    }
    if (memberships.length > 1) {
        redirect('/alliances/select_alliance')
    }
}

//1. Verify authenticated user

//2. Load memberships

//3. No memberships
      //-> redirect('/onboarding')

//4. One membership
      //-> redirect(`/alliances/${membership.allianceId}`)

//5. More than one membership
      //-> render alliance selector page

/* 
Get session
Check authentication
Load memberships
Render something basic
*/