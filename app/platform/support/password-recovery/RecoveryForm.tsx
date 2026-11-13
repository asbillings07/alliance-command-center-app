"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PasswordField } from "@/app/src/components/PasswordField";
import { Button } from "@/app/src/components/Button";
import { createRecoveryLink, type RecoveryActionResult } from "./actions";

type RecoveryLink = Extract<RecoveryActionResult, { ok: true }>;

export function RecoveryForm({ userId, email }: { userId: string; email: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [link, setLink] = useState<RecoveryLink | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const linkHeadingRef = useRef<HTMLHeadingElement>(null);
  const linkRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!link) return;
    linkHeadingRef.current?.focus();
    const timer = setTimeout(() => {
      setLink(null);
      setMessage("This recovery link has expired. Verify the account owner again to create a new one.");
    }, Math.max(0, new Date(link.expiresAt).getTime() - Date.now()));
    return () => clearTimeout(timer);
  }, [link]);

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setError(null);
    setMessage(null);
    startTransition(async () => {
      try {
        const result = await createRecoveryLink(form);
        if (!result.ok) { setError(result.error); return; }
        setLink(result);
        router.refresh();
      } catch {
        setError("Could not confirm link creation. Refresh to check issuance history before trying again; a new link may have replaced older links.");
      } finally {
        if (passwordRef.current) passwordRef.current.value = "";
      }
    });
  };

  const copy = async () => {
    if (!link) return;
    if (new Date(link.expiresAt).getTime() <= Date.now()) {
      setLink(null);
      setMessage("This link has expired. Create a new one after verifying the account owner.");
      return;
    }
    try {
      await navigator.clipboard.writeText(link.resetUrl);
      setMessage("Recovery link copied. Share it privately with the verified account owner.");
    } catch {
      linkRef.current?.focus();
      linkRef.current?.select();
      setMessage("Automatic copy was unavailable. Select and copy the recovery link below.");
    }
  };

  return (
    <div className="space-y-4">
      <p role="status" aria-live="polite" aria-atomic="true" className="text-sm text-text-secondary">{message}</p>
      {error && <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 p-3 text-sm text-danger-light">{error}</p>}
      {link ? (
        <section className="sentry-block space-y-4 rounded-lg border border-primary/40 bg-primary/5 p-4" data-sentry-block>
          <h3 ref={linkHeadingRef} tabIndex={-1} className="font-semibold text-text-primary">Recovery link ready</h3>
          <p className="text-sm text-text-secondary">No email was sent. Share this link only with the verified owner of <strong className="break-all">{email}</strong>. Anyone with the link can choose a new password for this account.</p>
          <p className="text-sm text-text-secondary">Expires {new Date(link.expiresAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}. It works once. The owner&apos;s existing sessions end after they set their new password.</p>
          <label htmlFor="recovery-link" className="block text-sm font-medium text-text-primary">Private recovery link</label>
          <textarea ref={linkRef} id="recovery-link" readOnly value={link.resetUrl} rows={4} autoComplete="off" spellCheck={false} className="w-full resize-none rounded-md border border-border bg-surface-secondary p-3 text-sm text-text-primary break-all" />
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={copy}>Copy recovery link</Button>
            <Button type="button" variant="secondary" onClick={() => { setLink(null); setMessage("Link hidden. It remains valid until used, replaced or expired."); }}>Hide link</Button>
          </div>
          <p className="text-xs text-text-muted">The link is shown only in this browser view. It is not available again after refreshing or leaving this page.</p>
        </section>
      ) : (
        <form onSubmit={submit} className="space-y-4" data-sentry-block>
          <input type="hidden" name="targetUserId" value={userId} />
          <input type="hidden" name="expectedEmail" value={email} />
          <p className="rounded-lg border border-warning/30 bg-warning/5 p-3 text-sm text-text-secondary">Creating a recovery link replaces any older reset links. It does not change the password yet. The new link expires in 15 minutes.</p>
          <label className="flex items-start gap-3 text-sm text-text-secondary">
            <input type="checkbox" name="identityConfirmed" value="yes" required disabled={isPending} className="mt-1 h-4 w-4 shrink-0 accent-primary" />
            <span>I verified the owner of <strong className="break-all text-text-primary">{email}</strong> through an established private contact. I will share the link only with that person.</span>
          </label>
          <PasswordField ref={passwordRef} label="Your administrator password" name="operatorPassword" autoComplete="current-password" required disabled={isPending} />
          <p className="text-xs text-text-muted">Enter your own password to authorize recovery. Never ask for the other person&apos;s password.</p>
          <Button type="submit" disabled={isPending} loading={isPending}>{isPending ? "Creating link…" : "Create recovery link"}</Button>
        </form>
      )}
    </div>
  );
}
