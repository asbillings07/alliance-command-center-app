import { redirect } from "next/navigation";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { getAccount, getSignInMethods } from "@/app/src/lib/account";
import { PageLayout, Card } from "@/app/src/components";
import { AccountProfileForm } from "./AccountProfileForm";
import { AccountEmailForm } from "./AccountEmailForm";
import { AccountSecurityForm } from "./AccountSecurityForm";

export const metadata = {
  title: "Account - Alliance Command Center",
  description: "Manage your account profile",
};

export default async function AccountPage() {
  const { id } = await requireAuth();

  // Reading through the service means the page always reflects the latest
  // persisted value (unlike the JWT session snapshot).
  const [account, methods] = await Promise.all([
    getAccount(id),
    getSignInMethods(id),
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
              canChange={!methods.hasGoogle}
            />
          </Card.Body>
        </Card>

        <Card>
          <Card.Header>Sign-in &amp; Security</Card.Header>
          <Card.Body>
            <AccountSecurityForm
              hasPassword={methods.hasPassword}
              hasGoogle={methods.hasGoogle}
            />
          </Card.Body>
        </Card>
      </div>
    </PageLayout>
  );
}
