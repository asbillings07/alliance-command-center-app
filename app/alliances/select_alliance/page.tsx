import { auth } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";
import { selectAlliance } from "./actions";
import { AllianceSelector } from "./AllianceSelector";
import { PageLayout, Card } from "@/app/src/components";
import { getAccount } from "@/app/src/lib/account";

export default async function SelectAlliancePage() {
    const session = await auth();

    if (!session || !session.user?.id) {
        redirect("/login");
    }

    // Read the display name live from the database rather than the JWT snapshot
    // (session.user.name), which stays stale after a display-name change until
    // the next sign-in. Session data is for authentication; mutable profile data
    // comes from its source of truth (see #127).
    const [account, alliances] = await Promise.all([
        getAccount(session.user.id),
        selectAlliance(session.user.id),
    ]);

    if (!account) {
        redirect("/login");
    }

    if (alliances.length === 0) {
        redirect("/app");
    }

    return (
        <PageLayout
            title="Choose an Alliance"
            description={`Welcome back, ${account.displayName}!`}
            maxWidth="md"
        >
            <Card>
                <Card.Body>
                    <AllianceSelector alliances={alliances} />
                </Card.Body>
            </Card>
        </PageLayout>
    );
}