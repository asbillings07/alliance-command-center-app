import { auth } from "@/app/src/lib/auth";
import { SignOutButton } from "@/app/src/components/client";

/**
 * Session-gated Sign Out affordance for the shared {@link PageLayout} header.
 *
 * PageLayout is also rendered on unauthenticated surfaces (e.g. the
 * `/design-system` preview), so the sign-out control must only appear when a
 * session actually exists. This keeps the affordance to authenticated
 * navigation rather than showing it where there is nothing to sign out of.
 *
 * Auth.js JWT sessions are read from the request cookie, so this is a cheap
 * check with no database round-trip.
 */
export async function SessionSignOut() {
  const session = await auth();

  if (!session?.user) {
    return null;
  }

  return (
    <div className="mb-4 flex justify-end">
      <SignOutButton variant="ghost" />
    </div>
  );
}
