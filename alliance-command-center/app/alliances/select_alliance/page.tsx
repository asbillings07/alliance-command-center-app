import { auth } from "@/app/src/auth";
import { redirect } from "next/navigation";
import { selectAlliance } from "./actions";
import { AllianceSelector } from "./AllianceSelector";

export default async function SelectAlliancePage() {
    const session = await auth();

    if (!session || !session.user?.id) {
        redirect("/login");
    }

    const alliances = await selectAlliance(session.user.id);

    if (alliances.length === 0) {
        redirect("/app");
    }

    return (
        <div className="flex flex-col items-center justify-center min-h-screen">
            <div>Welcome {session.user.name}!</div>
            <h1>Choose an Alliance</h1>
            <AllianceSelector alliances={alliances} />
        </div>
    );
}