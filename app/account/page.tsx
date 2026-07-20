import { redirect } from "next/navigation";
import { requireAuth } from "@/app/src/lib/auth/requireAuth";
import { getAccount } from "@/app/src/lib/account";
import { PageLayout, Card } from "@/app/src/components";
import { AccountProfileForm } from "./AccountProfileForm";

export const metadata = {
  title: "Account - Alliance Command Center",
  description: "Manage your account profile",
};

export default async function AccountPage() {
  const { id } = await requireAuth();

  // Reading through the service means the page always reflects the latest
  // persisted value (unlike the JWT session snapshot).
  const account = await getAccount(id);
  if (!account) {
    redirect("/login");
  }

  return (
    <PageLayout
      breadcrumb={[{ label: "Dashboard", href: "/app" }, { label: "Account" }]}
      title="Account"
      description="Manage your profile."
      maxWidth="lg"
    >
      <Card>
        <Card.Body>
          <AccountProfileForm
            displayName={account.displayName}
            email={account.email}
          />
        </Card.Body>
      </Card>
    </PageLayout>
  );
}
