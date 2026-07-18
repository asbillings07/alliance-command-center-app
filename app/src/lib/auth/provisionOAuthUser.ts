import { prisma } from "@/app/src/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { User } from "@/app/generated/prisma/client";

/**
 * Provision a user from a Google sign-in.
 *
 * This is the single place a new Google identity becomes a platform user. It
 * does not merely insert a row - it provisions an identity into our domain
 * model, anchoring the Google subject and leaving `passwordHash` null (a
 * Google-provisioned user has no password until they set one).
 *
 * Race-safe (find-or-create): concurrent sign-ins from double-clicks or multiple
 * tabs cannot create duplicates. We look up by email first, and if a create loses
 * a race we recover from the unique-email violation by re-fetching.
 */
export type ProvisionOAuthUserInput = {
  email: string;
  displayName: string;
  googleSubject: string;
};

export async function provisionOAuthUser({
  email,
  displayName,
  googleSubject,
}: ProvisionOAuthUserInput): Promise<User> {
  const normalizedEmail = email.toLowerCase().trim();

  const existing = await prisma.user.findUnique({
    where: { email: normalizedEmail },
  });
  if (existing) {
    return existing;
  }

  try {
    return await prisma.user.create({
      data: {
        email: normalizedEmail,
        displayName: displayName.trim() || normalizedEmail,
        passwordHash: null,
        googleSubject,
      },
    });
  } catch (error) {
    // Lost a race with a concurrent sign-in: the user now exists.
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      const raced = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (raced) {
        return raced;
      }
    }
    throw error;
  }
}
