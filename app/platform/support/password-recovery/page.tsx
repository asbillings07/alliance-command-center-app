import Link from "next/link";
import { Button } from "@/app/src/components/Button";
import { requirePlatformAdmin } from "@/app/src/lib/auth/requirePlatformAdmin";
import { getPasswordRecoveryAccount } from "@/app/src/lib/platform/passwordRecovery";
import { getSignInMethods } from "@/app/src/lib/account";
import { RecoveryForm } from "./RecoveryForm";

export const metadata = { title: "Password recovery | Platform Support", robots: { index: false, follow: false } };

export default async function PasswordRecoveryPage({ searchParams }: {
  searchParams: Promise<{ email?: string; userId?: string }>;
}) {
  const actor = await requirePlatformAdmin();
  const params = await searchParams;
  const email = typeof params.email === "string" ? params.email.trim().slice(0, 320) : "";
  const userId = typeof params.userId === "string" ? params.userId.slice(0, 200) : "";
  const [account, actorMethods] = await Promise.all([
    getPasswordRecoveryAccount({ userId: userId || undefined, email: email || undefined }),
    getSignInMethods(actor.id),
  ]);
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <Link href="/platform/support" className="text-sm text-primary hover:underline">← Platform Support</Link>
        <h1 className="mt-3 text-2xl font-semibold text-text-primary">Password recovery</h1>
        <p className="mt-2 text-sm text-text-secondary">Help an existing account owner when their reset email has not arrived. They choose their own new password using a private, one-time link.</p>
      </div>
      <form action="/platform/support/password-recovery" method="get" className="space-y-2">
        <label htmlFor="recovery-email" className="block text-sm font-medium text-text-primary">Account email</label>
        <div className="flex flex-col gap-3 sm:flex-row">
          <input id="recovery-email" name="email" type="email" required defaultValue={email} autoComplete="off" className="min-w-0 flex-1 rounded-lg border border-border bg-surface-secondary p-3 text-text-primary" />
          <Button type="submit">Find account</Button>
        </div>
      </form>
      {(email || userId) && !account && <p role="status" className="text-sm text-text-secondary">No account found. Check the registered email address. Pending invitations are managed in Beta.</p>}
      {account && <>
        <section className="min-w-0 space-y-4 rounded-xl border border-border bg-surface p-4 sm:p-6">
          <div className="min-w-0">
            <h2 className="break-words text-xl font-semibold text-text-primary">{account.displayName || "Account owner"}</h2>
            <p className="break-all text-sm text-text-secondary">{account.email}</p>
            {account.alliances.length > 0 && <ul className="mt-2 space-y-1 text-sm">
              {account.alliances.map((a) => <li key={a.id}><Link href={`/platform/support/alliance/${a.id}`} className="text-primary hover:underline">{a.name} — alliance support</Link></li>)}
            </ul>}
          </div>
          {account.isPlatformAdmin ? <p className="text-sm text-text-secondary">Platform administrator accounts must use their existing account recovery process.</p>
            : !account.hasPassword ? <p className="text-sm text-text-secondary">This account uses Google sign-in and has no password to reset. Ask the owner to use their connected Google account.</p>
              : !actorMethods?.hasPassword ? <p className="text-sm text-text-secondary">This recovery tool requires your administrator password. Manage your sign-in methods in <Link href="/account" className="text-primary underline">Account</Link>.</p>
                : <RecoveryForm key={account.id} userId={account.id} email={account.email} />}
        </section>
        {account.events.length > 0 && <section aria-labelledby="recovery-history-heading" className="space-y-3">
          <h2 id="recovery-history-heading" className="font-semibold text-text-primary">Recent recovery links</h2>
          <p className="text-sm text-text-secondary">These records show link creation, not proof that a password was changed.</p>
          <ul className="space-y-2">
            {account.events.map((event) => <li key={event.id} className="rounded-lg border border-border p-3 text-sm text-text-secondary">
              <span className="block break-words text-text-primary">Created by {event.actorName || "Platform administrator"}</span>
              <time dateTime={event.createdAt.toISOString()}>{event.createdAt.toISOString().replace("T", " ").slice(0, 19)} UTC</time>
            </li>)}
          </ul>
        </section>}
      </>}
    </div>
  );
}
