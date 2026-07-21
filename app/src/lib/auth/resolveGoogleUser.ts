import { prisma } from "@/app/src/lib/prisma";
import type { User } from "@/app/generated/prisma/client";
import { isInvitationEligible } from "@/app/src/lib/auth/identity/eligibility";
import {
  GoogleAutoLinkBlockedError,
  InvitationRequiredError,
} from "@/app/src/lib/auth/identity/errors";
import { provisionOAuthUser } from "@/app/src/lib/auth/provisionOAuthUser";
import { ensureGoogleIdentity } from "@/app/src/lib/auth/ensureGoogleIdentity";

/**
 * Resolve the internal platform user for a Google sign-in (ADR-013, #144).
 *
 * The Google subject (`sub`) is the identity key; a verified email is used only
 * to link an existing account on first Google sign-in and to provision a brand
 * new one. Once a user is linked, the app's stored email and display name are
 * authoritative and are never overwritten by Google:
 *
 *   Identity providers authenticate users; AllianceHQ owns user profile data.
 *
 * Resolution order:
 *   1. By `googleSubject` -> returning user (email may have diverged; leave it).
 *   2. By verified email -> existing account; link/assert the subject, unless
 *      the owner explicitly disconnected Google (auto-link is blocked).
 *   3. Neither -> invitation-gated provisioning of a new user.
 *
 * Postcondition: on successful return, `user.googleSubject === googleSubject`.
 * This is the guarantee the JWT callback relies on to resolve the internal user
 * by subject alone.
 *
 * Throws (surfaced by the caller as an access denial): `GoogleAccountMismatchError`
 * when the email belongs to an account anchored to a different subject,
 * `GoogleAutoLinkBlockedError` when the email matches an account that disconnected
 * Google (#131), and `InvitationRequiredError` when a new email is not
 * invitation-eligible.
 */
export type ResolveGoogleUserInput = {
  email: string;
  googleSubject: string;
  displayName: string;
};

export async function resolveGoogleUser({
  email,
  googleSubject,
  displayName,
}: ResolveGoogleUserInput): Promise<User> {
  // 1. Returning user: the subject is the stable anchor. Email/display name may
  //    have diverged from Google since linking; that is intentional — we do not
  //    resync profile data from the provider.
  const bySubject = await prisma.user.findUnique({ where: { googleSubject } });
  if (bySubject) {
    return bySubject;
  }

  // 2. First-time link (also the lazy backfill for accounts that predate subject
  //    storage): a verified email matches an existing account. ensureGoogleIdentity
  //    links the subject, or throws GoogleAccountMismatchError if the account is
  //    already anchored to a different Google identity.
  //
  //    A verified email is NOT sufficient to link an account whose owner
  //    explicitly disconnected Google: that disconnection is durable
  //    (googleAutoLinkBlockedAt), so refuse rather than silently re-link. The
  //    user reconnects deliberately via the explicit connect flow, which clears
  //    the flag. The guarded write in ensureGoogleIdentity re-checks the flag to
  //    close the disconnect-mid-sign-in race.
  const byEmail = await prisma.user.findUnique({ where: { email } });
  if (byEmail) {
    if (byEmail.googleAutoLinkBlockedAt !== null) {
      throw new GoogleAutoLinkBlockedError();
    }
    await ensureGoogleIdentity(byEmail, googleSubject, {
      requireAutoLinkEnabled: true,
    });
    return { ...byEmail, googleSubject };
  }

  // 3. Brand-new user: gate provisioning behind the invitation model.
  if (!(await isInvitationEligible(email))) {
    throw new InvitationRequiredError();
  }

  const provisioned = await provisionOAuthUser({
    email,
    displayName,
    googleSubject,
  });

  // provisionOAuthUser is find-or-create: if it lost an email-unique race it
  // returns the pre-existing row, whose subject may be null or differ. Re-assert
  // the invariant so the postcondition holds and a raced account can never be
  // silently re-linked. (A freshly created row already carries our subject, so
  // this is a cheap no-op.)
  await ensureGoogleIdentity(provisioned, googleSubject);
  return { ...provisioned, googleSubject };
}
