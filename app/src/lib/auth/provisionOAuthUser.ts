import { prisma } from "@/app/src/lib/prisma";
import { Prisma } from "@/app/generated/prisma/client";
import type { User } from "@/app/generated/prisma/client";
import type { AuthProvider } from "@/app/generated/prisma/enums";

/**
 * Provision a user from an OAuth sign-in.
 *
 * This is the single place OAuth identities become platform users. It does not
 * merely insert a row - it provisions an identity into our domain model, setting
 * the explicit `authProvider` and leaving `passwordHash` null (OAuth users have
 * no password).
 *
 * Race-safe (find-or-create): concurrent sign-ins from double-clicks or multiple
 * tabs cannot create duplicates. We look up by email first, and if a create loses
 * a race we recover from the unique-email violation by re-fetching.
 */
export type ProvisionOAuthUserInput = {
  email: string;
  displayName: string;
  provider: AuthProvider;
};

export async function provisionOAuthUser({
  email,
  displayName,
  provider,
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
        authProvider: provider,
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
