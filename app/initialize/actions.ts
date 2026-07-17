"use server";

import bcrypt from "bcrypt";
import { signIn } from "@/app/src/lib/auth";
import { prisma } from "@/app/src/lib/prisma";
import { redirect } from "next/navigation";
import {
  isPlatformInitialized,
  canInitializePlatform,
  verifyBootstrapSecret,
} from "@/app/src/lib/platform";

export type InitializeState = {
  error: string | null;
};

/**
 * Initialize the platform by creating the first platform administrator.
 *
 * This action:
 * 1. Verifies the platform is not already initialized (race protection)
 * 2. Verifies the bootstrap secret (proof of deployment ownership)
 * 3. Validates the email is in PLATFORM_ADMIN_EMAILS (bootstrap authorization)
 * 4. Creates a user with isPlatformAdmin: true
 * 5. Signs them in
 * 6. Redirects to /platform
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
  const bootstrapSecret = formData.get("bootstrapSecret")?.toString();

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

  // Bootstrap secret: proof of deployment ownership. Checked before the email
  // authorization so a caller without the secret can't probe which emails are
  // allowed to initialize.
  if (!verifyBootstrapSecret(bootstrapSecret)) {
    return {
      error:
        "Invalid or missing bootstrap secret. " +
        "Contact the system administrator.",
    };
  }

  // Bootstrap authorization: only emails in PLATFORM_ADMIN_EMAILS can initialize
  if (!canInitializePlatform(email)) {
    return {
      error:
        "This email is not authorized to initialize the platform. " +
        "Contact the system administrator.",
    };
  }

  try {
    const passwordHash = await bcrypt.hash(password, 12);

    // Atomic initialization: check + create in a serializable transaction
    // This prevents race conditions where two requests both see "uninitialized"
    await prisma.$transaction(
      async (tx) => {
        // Double-check no platform admin exists (atomic with create)
        const existingAdminCount = await tx.user.count({
          where: { isPlatformAdmin: true },
        });

        if (existingAdminCount > 0) {
          throw new Error("ALREADY_INITIALIZED");
        }

        // Check if user already exists
        const existingUser = await tx.user.findUnique({
          where: { email },
        });

        if (existingUser) {
          throw new Error("USER_EXISTS");
        }

        // Create the first platform admin
        await tx.user.create({
          data: {
            email,
            displayName,
            passwordHash,
            isPlatformAdmin: true,
          },
        });
      },
      {
        isolationLevel: "Serializable",
      }
    );

    // Sign them in
    await signIn("credentials", {
      email,
      password,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "ALREADY_INITIALIZED") {
        return { error: "Platform has already been initialized" };
      }
      if (error.message === "USER_EXISTS") {
        return { error: "An account with this email already exists" };
      }
    }
    console.error("Error initializing platform:", error);
    return { error: "Failed to initialize platform" };
  }

  // Redirect to the platform console
  redirect("/platform");
}
