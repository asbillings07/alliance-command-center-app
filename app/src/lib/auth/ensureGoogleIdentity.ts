import { prisma } from "@/app/src/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { User } from "@/app/generated/prisma/client";
import { GoogleAccountMismatchError } from "./identity/errors";

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
  googleSubject: string
): Promise<void> {
  if (user.googleSubject) {
    if (user.googleSubject === googleSubject) {
      return;
    }
    throw new GoogleAccountMismatchError();
  }

  try {
    await prisma.user.update({
      where: { id: user.id },
      data: { googleSubject },
    });
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
