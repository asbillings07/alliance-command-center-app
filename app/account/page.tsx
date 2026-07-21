import { redirect } from "next/navigation";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { getAccount, getSignInMethods } from "@/app/src/lib/account";
import { isGoogleAuthEnabled } from "@/app/src/lib/auth/identity/google";
import { readConnectResult } from "@/app/src/lib/auth/googleConnection";
import { PageLayout, Card } from "@/app/src/components";
import { AccountProfileForm } from "./AccountProfileForm";
import { AccountEmailForm } from "./AccountEmailForm";
import { AccountSecurityForm } from "./AccountSecurityForm";
import { GoogleConnectResultBanner } from "./GoogleConnectResultBanner";

// The connect-result banner cookie is read per request, so this page must not
// be statically cached.
export const dynamic = "force-dynamic";

export const metadata = {
  title: "Account - Alliance Command Center",
  description: "Manage your account profile",
};

export default async function AccountPage() {
  const { id } = await requireAuth();

  // Reading through the service means the page always reflects the latest
  // persisted value (unlike the JWT session snapshot).
  const isGoogleEnabled = isGoogleAuthEnabled();

  const [account, methods, connectResult] = await Promise.all([
    getAccount(id),
    getSignInMethods(id),
    // Only meaningful when Google is configured; skip the read otherwise.
    isGoogleEnabled ? readConnectResult() : Promise.resolve(null),
  ]);
  if (!account || !methods) {
    redirect("/login");
  }

  return (
    <PageLayout
      breadcrumb={[{ label: "Dashboard", href: "/app" }, { label: "Account" }]}
      title="Account"
      description="Manage your profile and sign-in security."
      maxWidth="lg"
    >
      <div className="space-y-6">
        <Card>
          <Card.Body>
            <AccountProfileForm displayName={account.displayName} />
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>Email</Card.Header>
          <Card.Body>
            <AccountEmailForm
              email={account.email}
              canChange={methods.hasPassword}
            />
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>Sign-in &amp; Security</Card.Header>
          <Card.Body>
            {connectResult && (
              <GoogleConnectResultBanner result={connectResult} />
            )}
            <AccountSecurityForm
              hasPassword={methods.hasPassword}
              hasGoogle={methods.hasGoogle}
              googleEmail={methods.googleEmail}
              isGoogleEnabled={isGoogleEnabled}
            />
          </Card.Body>
        </Card>
      </div>
    </PageLayout>
  );
}
