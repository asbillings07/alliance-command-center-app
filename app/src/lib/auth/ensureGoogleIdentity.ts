import { prisma } from "@/app/src/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { User } from "@/app/generated/prisma/client";
import {
  GoogleAccountMismatchError,
  GoogleAutoLinkBlockedError,
} from "./identity/errors";

export type EnsureGoogleIdentityOptions = {
  /**
   * When true, refuse to auto-link an account that has explicitly disconnected
   * Google (`googleAutoLinkBlockedAt` set). Used by the lazy email-match path
   * during normal sign-in so a durable disconnect is honored even under a race.
   * Explicit connect omits this (and clears the flag itself), because the user
   * is deliberately re-linking.
   */
  requireAutoLinkEnabled?: boolean;
};

/**
 * Enforce the invariant that an existing user is associated with exactly this
 * Google identity (subject). This owns the account-linking rules so the auth
 * callback only has to orchestrate:
 *
 * - No anchor yet -> link it (backfill on first Google sign-in). Existing
 *   Google-only users predate subject storage; they are anchored the next time
 *   they sign in.
 * - Same anchor -> no-op (already linked).
 * - Different anchor -> throw. A verified email match is not sufficient to
 *   re-point an account at a different Google account; we never silently
 *   re-link, which would enable takeover via email reuse.
 *
 * `sub` is the security anchor: email identifies, subject is identity.
 */
export async function ensureGoogleIdentity(
  user: Pick<User, "id" | "googleSubject">,
  googleSubject: string,
  options: EnsureGoogleIdentityOptions = {}
): Promise<void> {
  if (user.googleSubject) {
    if (user.googleSubject === googleSubject) {
      return;
    }
    throw new GoogleAccountMismatchError();
  }

  // No anchor observed on the row we read. Link with a *guarded* write so a
  // concurrent sign-in that anchored a subject between our read and this write
  // (TOCTOU) cannot be silently overwritten: only update while still unanchored.
  // On the lazy path we also guard on the disconnect flag still being null, so a
  // disconnect that lands mid-flight cannot be clobbered by an auto-link.
  try {
    const { count } = await prisma.user.updateMany({
      where: {
        id: user.id,
        googleSubject: null,
        ...(options.requireAutoLinkEnabled
          ? { googleAutoLinkBlockedAt: null }
          : {}),
      },
      data: { googleSubject },
    });

    if (count === 0) {
      // The row was anchored, blocked, or removed concurrently. Re-read and
      // disambiguate: an identical subject means a racing sign-in linked the
      // same Google account (idempotent, allow); a disconnect that landed
      // first must surface as a blocked auto-link; anything else is a genuine
      // mismatch. We never re-link.
      const current = await prisma.user.findUnique({
        where: { id: user.id },
        select: { googleSubject: true, googleAutoLinkBlockedAt: true },
      });
      if (current?.googleSubject === googleSubject) {
        return;
      }
      if (options.requireAutoLinkEnabled && current?.googleAutoLinkBlockedAt) {
        throw new GoogleAutoLinkBlockedError();
      }
      throw new GoogleAccountMismatchError();
    }
  } catch (error) {
    // A unique-constraint violation means this subject is already anchored to a
    // different user (email reuse / takeover attempt) -> refuse rather than link.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      throw new GoogleAccountMismatchError();
    }
    throw error;
  }
}
