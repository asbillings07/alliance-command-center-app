"use server";

import bcrypt from "bcrypt";
import { signIn } from "@/app/src/lib/auth";
import { prisma } from "@/app/src/lib/prisma";
import { redirect } from "next/navigation";
import {
  validateBetaToken,
  validateBetaCode,
} from "@/app/src/lib/betaInvitation";

export type RegisterState = {
  error: string | null;
};

function sanitizeCallbackUrl(url: string): string {
  if (!url || !url.startsWith("/") || url.startsWith("//")) {
    return "/app";
  }
  try {
    const parsed = new URL(url, "http://localhost");
    if (parsed.origin !== "http://localhost") {
      return "/app";
    }
  } catch {
    return "/app";
  }
  return url;
}

export async function register(
  _prevState: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();
  const confirmPassword = formData.get("confirmPassword")?.toString();
  const displayName = formData.get("displayName")?.toString().trim();
  const rawCallbackUrl = formData.get("callbackUrl")?.toString() || "";

  if (!email || !password || !displayName) {
    return { error: "All fields are required" };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return { error: "An account with this email already exists" };
  }

  const callbackUrl = sanitizeCallbackUrl(rawCallbackUrl);

  // Check for beta invitation from /redeem/[token] or /redeem/code?code=XXX
  const redeemMatch = callbackUrl.match(/\/redeem\/([^/?]+)/);
  if (redeemMatch) {
    const betaTokenOrCode = redeemMatch[1];
    const isCodeLookup = betaTokenOrCode === "code";
    const codeMatch = callbackUrl.match(/[?&]code=([^&]+)/);
    const decodedCode =
      isCodeLookup && codeMatch
        ? (() => {
            try {
              return decodeURIComponent(codeMatch[1]);
            } catch {
              return codeMatch[1];
            }
          })()
        : null;

    const result =
      isCodeLookup && decodedCode
        ? await validateBetaCode(decodedCode)
        : await validateBetaToken(betaTokenOrCode);
    if (result.status === "not_found") {
      return { error: "Beta invitation not found" };
    }

    if (result.status === "expired") {
      return { error: "This beta invitation has expired" };
    }

    if (result.status === "revoked") {
      return { error: "This beta invitation has been revoked" };
    }

    if (result.status === "already_accepted") {
      return { error: "This beta invitation has already been accepted" };
    }

    const betaInvitation = result.invitation;

    if (betaInvitation.email.toLowerCase() !== email) {
      return { error: "Email does not match the invitation" };
    }

    try {
      const passwordHash = await bcrypt.hash(password, 12);

      // Use a transaction to ensure user creation and invitation acceptance
      // are atomic. If either fails, the entire operation rolls back.
      // This prevents orphaned users if acceptBetaInvitation fails.
      await prisma.$transaction(async (tx) => {
        const user = await tx.user.create({
          data: {
            email,
            displayName,
            passwordHash,
          },
        });

        // Auto-accept the beta invitation with a race-safe update.
        // Require the invitation to still be unaccepted AND unrevoked: it may
        // have been revoked after validation but before this transaction ran.
        const result = await tx.betaInvitation.updateMany({
          where: {
            id: betaInvitation.id,
            acceptedAt: null,
            revokedAt: null,
          },
          data: {
            acceptedAt: new Date(),
            acceptedByUserId: user.id,
          },
        });

        // No rows updated means the invitation changed state between validation
        // and this transaction. Determine why so we can surface an accurate error.
        if (result.count === 0) {
          const current = await tx.betaInvitation.findUnique({
            where: { id: betaInvitation.id },
            select: { revokedAt: true },
          });
          throw new Error(
            current?.revokedAt ? "INVITATION_REVOKED" : "INVITATION_ALREADY_ACCEPTED"
          );
        }
      });

      await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
    } catch (error) {
      if (error instanceof Error) {
        if (error.message === "INVITATION_REVOKED") {
          return { error: "This beta invitation has been revoked" };
        }
        if (error.message === "INVITATION_ALREADY_ACCEPTED") {
          return { error: "This beta invitation has already been accepted" };
        }
      }
      console.error("Error creating account", error);
      return { error: "Failed to create account" };
    }

    // Redirect to create-alliance since the beta is now auto-accepted
    redirect("/create-alliance");
  }

  // Check for alliance invitation from /invite/[token]
  const tokenMatch = callbackUrl.match(/\/invite\/([^/?]+)/);
  if (!tokenMatch) {
    return { error: "Registration requires a valid invitation" };
  }

  const token = tokenMatch[1];
  const isCodeLookup = token === "code";
  const codeMatch = callbackUrl.match(/[?&]code=([^&]+)/);

  const invitation = await prisma.invitation.findFirst({
    where: isCodeLookup && codeMatch
      ? { code: decodeURIComponent(codeMatch[1]) }
      : { token },
  });

  if (!invitation) {
    return { error: "Invalid invitation" };
  }

  if (invitation.acceptedAt) {
    return { error: "This invitation has already been accepted" };
  }

  if (invitation.cancelledAt) {
    return { error: "This invitation has been cancelled" };
  }

  if (invitation.expiresAt < new Date()) {
    return { error: "This invitation has expired" };
  }

  if (invitation.playerNameSnapshot !== displayName) {
    return { error: "Invalid registration attempt" };
  }

  if (invitation.email.toLowerCase() !== email) {
    return { error: "Email does not match the invitation" };
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash,
      },
    });

    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (error) {
    console.error("Error creating account", error);
    return { error: "Failed to create account" };
  }

  redirect(callbackUrl);
}
