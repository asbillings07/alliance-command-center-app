import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/app/src/lib/auth";
import { isGoogleAuthEnabled } from "@/app/src/lib/auth/identity/google";
import { readConnectResult } from "@/app/src/lib/auth/googleConnection";
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
    // A denied explicit Google connect (#131) lands on the error page while the
    // user is still signed in. Route them back to /account so the signed
    // connect-result cookie surfaces as a banner rather than dropping them on
    // /app with no feedback. Gated on Google being enabled: when it is disabled,
    // /account skips reading (and clearing) the cookie, so redirecting here would
    // just bounce the user to /account without ever acknowledging it. Let the
    // short-lived cookie expire on its own instead.
    if (isGoogleAuthEnabled() && (await readConnectResult())) {
      redirect("/account");
    }
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
