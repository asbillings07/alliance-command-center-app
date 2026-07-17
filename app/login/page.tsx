import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/app/src/lib/auth";
import { isGoogleAuthEnabled } from "@/app/src/lib/auth/identity/google";
import { sanitizeCallbackUrl } from "@/app/src/lib/auth/callbackUrl";
import { LoginForm } from "./LoginForm";

// Evaluate isGoogleAuthEnabled() per request so the Google CTA reflects runtime
// configuration rather than build-time env.
export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ callbackUrl?: string }>;
}) {
  // Already authenticated: skip the login page entirely.
  const session = await auth();
  if (session?.user?.id) {
    const { callbackUrl } = await searchParams;
    redirect(sanitizeCallbackUrl(callbackUrl));
  }

  const googleEnabled = isGoogleAuthEnabled();

  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center bg-background">
          <div className="text-text-muted">Loading...</div>
        </div>
      }
    >
      <LoginForm googleEnabled={googleEnabled} />
    </Suspense>
  );
}
