"use server";

import bcrypt from "bcrypt";
import { signIn } from "@/app/src/lib/auth";
import { prisma } from "@/app/src/lib/prisma";
import { redirect } from "next/navigation";
import {
  isPlatformInitialized,
  canInitializePlatform,
} from "@/app/src/lib/platform";

export type InitializeState = {
  error: string | null;
};

/**
 * Initialize the platform by creating the first platform administrator.
 *
 * This action:
 * 1. Verifies the platform is not already initialized (race protection)
 * 2. Validates the email is in PLATFORM_ADMIN_EMAILS (bootstrap authorization)
 * 3. Creates a user with isPlatformAdmin: true
 * 4. Signs them in
 * 5. Redirects to /platform
 *
 * Note: This does NOT create a beta invitation. Bootstrap users are operators,
 * not beta testers. These are separate concepts.
 */
export async function initializePlatform(
  _prevState: InitializeState,
  formData: FormData
): Promise<InitializeState> {
  const email = formData.get("email")?.toString().trim().toLowerCase();
  const password = formData.get("password")?.toString();
  const confirmPassword = formData.get("confirmPassword")?.toString();
  const displayName = formData.get("displayName")?.toString().trim();

  if (!email || !password || !displayName) {
    return { error: "All fields are required" };
  }

  if (password !== confirmPassword) {
    return { error: "Passwords do not match" };
  }

  if (password.length < 8) {
    return { error: "Password must be at least 8 characters" };
  }

  // Race condition protection: verify platform is still uninitialized
  const alreadyInitialized = await isPlatformInitialized();
  if (alreadyInitialized) {
    return { error: "Platform has already been initialized" };
  }

  // Bootstrap authorization: only emails in PLATFORM_ADMIN_EMAILS can initialize
  if (!canInitializePlatform(email)) {
    return {
      error:
        "This email is not authorized to initialize the platform. " +
        "Contact the system administrator.",
    };
  }

  // Check if user already exists (shouldn't happen, but protect against it)
  const existingUser = await prisma.user.findUnique({
    where: { email },
  });

  if (existingUser) {
    return { error: "An account with this email already exists" };
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    // Create the first platform admin
    await prisma.user.create({
      data: {
        email,
        displayName,
        passwordHash,
        isPlatformAdmin: true,
      },
    });

    // Sign them in
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (error) {
    console.error("Error initializing platform:", error);
    return { error: "Failed to initialize platform" };
  }

  // Redirect to the platform console
  redirect("/platform");
}
