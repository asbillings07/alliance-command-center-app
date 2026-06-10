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
    // load memberships
    const memberships = await prisma.allianceMembership.findMany({
        where: {
            userId: session.user.id,
        },
    });

    if (!memberships?.length) {
        // redirect to onboarding page
        redirect("/onboarding");
    }
  return <div>Welcome {session.user.name}!</div>;
}

/* 
Get session
Check authentication
Load memberships
Render something basic
*/