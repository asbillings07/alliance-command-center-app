import { auth } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";
import { selectAlliance } from "./actions";
import { AllianceSelector } from "./AllianceSelector";
import { PageLayout, Card } from "@/app/src/components";

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
        <PageLayout
            title="Choose an Alliance"
            description={`Welcome back, ${session.user.name}!`}
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