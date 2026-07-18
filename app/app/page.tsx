import { auth } from "@/app/src/lib/auth";
import { redirect } from "next/navigation";
import { getPostLoginRedirect } from "@/app/src/lib/auth/getPostLoginRedirect";

export default async function AppPage() {
    const session = await auth();

    if (!session || !session.user?.id) {
        redirect("/login");
    }

    // /app is a pure router: it resolves the landing page for the current user
    // state and redirects. All routing rules live in getPostLoginRedirect. We
    // pass the session user (incl. the isPlatformAdmin hint) so routing needs no
    // extra DB round-trip on every visit.
    redirect(
        await getPostLoginRedirect({
            id: session.user.id,
            email: session.user.email,
            isPlatformAdmin: session.user.isPlatformAdmin,
        }),
    );
}
