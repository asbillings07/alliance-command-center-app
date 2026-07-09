"use server";

import bcrypt from "bcrypt";
import { signIn } from "@/app/src/lib/auth";
import { prisma } from "@/app/src/lib/prisma";
import { redirect } from "next/navigation";

export type RegisterState = {
  error: string | null;
};

export async function register(
  _prevState: RegisterState,
  formData: FormData
): Promise<RegisterState> {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();
  const confirmPassword = formData.get("confirmPassword")?.toString();
  const displayName = formData.get("displayName")?.toString().trim();
  const callbackUrl = formData.get("callbackUrl")?.toString() || "";

  if (!email || !password || !displayName) {
    return { error: "All fields are required" };
  }

  // Extract invitation token from callbackUrl and validate
  const tokenMatch = callbackUrl.match(/\/invite\/([^/?]+)/);
  if (!tokenMatch) {
    return { error: "Registration requires a valid invitation" };
  }

  const token = tokenMatch[1];
  
  // Handle code-based lookup
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

  // Verify the display name matches the invitation
  if (invitation.playerNameSnapshot !== displayName) {
    return { error: "Invalid registration attempt" };
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
