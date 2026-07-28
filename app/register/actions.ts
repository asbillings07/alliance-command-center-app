"use server";

import bcrypt from "bcrypt";
import { signIn } from "@/app/src/lib/auth";
import { prisma } from "@/app/src/lib/prisma";
import { redirect } from "next/navigation";
import {
  validateBetaToken,
  validateBetaCode,
  acceptBetaInvitationWithTx,
} from "@/app/src/lib/betaInvitation";
import { sanitizeCallbackUrl } from "@/app/src/lib/auth/callbackUrl";
import { validateDisplayName, validatePassword } from "@/app/src/lib/account";
import { normalizeEmail } from "@/app/src/lib/email/normalize";

export type RegisterState = {
  error: string | null;
};

export async function register(
  _prevState: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const rawEmail = formData.get("email")?.toString();
  const email = rawEmail ? normalizeEmail(rawEmail) : undefined;
  const password = formData.get("password")?.toString();
  const confirmPassword = formData.get("confirmPassword")?.toString();
  const rawCallbackUrl = formData.get("callbackUrl")?.toString() || "";

  if (!email || !password) {
    return { error: "All fields are required" };
  }

  // Display-name rules live in the account service so registration and account
  // updates can never drift apart.
  const displayNameResult = validateDisplayName(formData.get("displayName"));
  if (!displayNameResult.ok) {
    return { error: displayNameResult.message };
  }
  const displayName = displayNameResult.value;

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  // Password rules live in the account service, shared with account security
  // and platform bootstrap, so they can never drift apart.
  const passwordResult = validatePassword(password);
  if (!passwordResult.ok) {
    return { error: passwordResult.message };
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

    if (normalizeEmail(betaInvitation.email) !== email) {
      return { error: "Email does not match the invitation" };
    }

    try {
      const passwordHash = await bcrypt.hash(password, 12);

      const registerTransactionOptions = {
        isolationLevel: "Serializable" as const,
        maxWait: 5000,
        timeout: 10000,
      };

      const maxRegisterAttempts = 3;
      let registered = false;
      for (let attempt = 0; attempt < maxRegisterAttempts && !registered; attempt++) {
        try {
          // User creation and invitation acceptance are atomic so a failed
          // accept never leaves an orphaned account (#174).
          await prisma.$transaction(async (tx) => {
            const user = await tx.user.create({
              data: {
                email,
                displayName,
                passwordHash,
              },
            });

            await acceptBetaInvitationWithTx(tx, betaInvitation.id, user.id);
          }, registerTransactionOptions);
          registered = true;
        } catch (error) {
          const isSerializationFailure =
            error instanceof Error &&
            "code" in error &&
            (error as { code?: string }).code === "P2034";
          if (isSerializationFailure && attempt < maxRegisterAttempts - 1) {
            continue;
          }
          if (error instanceof Error) {
            if (error.message === "This beta invitation has been revoked") {
              return { error: "This beta invitation has been revoked" };
            }
            if (
              error.message === "This beta invitation has already been accepted"
            ) {
              return { error: "This beta invitation has already been accepted" };
            }
          }
          throw error;
        }
      }

      if (!registered) {
        return { error: "Failed to create account" };
      }

      await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
    } catch (error) {
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

  if (normalizeEmail(invitation.email) !== email) {
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
