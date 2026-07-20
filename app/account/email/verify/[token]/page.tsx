import { peekEmailChangeRequest } from "@/app/src/lib/emailChange";
import { ConfirmEmailChangeForm } from "./ConfirmEmailChangeForm";

export const metadata = {
  title: "Confirm email change - Alliance Command Center",
  description: "Confirm your new sign-in email",
};

type PageProps = {
  params: Promise<{ token: string }>;
};

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="max-w-md w-full bg-surface border border-border rounded-lg p-8">
        <h1 className="text-xl font-bold text-text-primary mb-6 text-center">
          Confirm your new email
        </h1>
        {children}
      </div>
    </div>
  );
}

export default async function VerifyEmailChangePage({ params }: PageProps) {
  const { token } = await params;

  const pending = await peekEmailChangeRequest(token);

  if (!pending) {
    return (
      <CardShell>
        <p className="text-text-muted text-sm text-center mb-6">
          This verification link is invalid or has expired. If you still want to
          change your email, start again from your account page.
        </p>
        <div className="text-center">
          <a href="/account" className="text-primary-light hover:text-primary">
            Go to your account
          </a>
        </div>
      </CardShell>
    );
  }

  return (
    <CardShell>
      <ConfirmEmailChangeForm token={token} newEmail={pending.newEmail} />
    </CardShell>
  );
}
