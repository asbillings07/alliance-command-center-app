import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcrypt";
import { prisma } from "./prisma";
import { validatePassword } from "./auth/passwordPolicy";

/** How long a reset link stays valid. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const BCRYPT_COST = 12;

export type CreatedPasswordResetToken = {
  /** The raw token to embed in the emailed link. Never persisted. */
  rawToken: string;
  expiresAt: Date;
};

/**
 * Hash a raw token for storage/lookup. Reset tokens are high-entropy random
 * values, so a fast SHA-256 (deterministic, no salt) is the right tool - unlike
 * user-chosen passwords, which use bcrypt.
 */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

/**
 * Create a single-use password reset token for a user.
 *
 * Any prior outstanding (unused) tokens are invalidated first, so only the most
 * recent link works. Only the SHA-256 hash is persisted; the returned value
 * object carries the raw token and expiry so the caller can build the email
 * without re-querying.
 */
export async function createPasswordResetToken(
  userId: string
): Promise<CreatedPasswordResetToken> {
  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);
  const now = new Date();

  await prisma.$transaction([
    prisma.passwordResetToken.updateMany({
      where: { userId, usedAt: null },
      data: { usedAt: now },
    }),
    prisma.passwordResetToken.create({
      data: { userId, tokenHash, expiresAt },
    }),
  ]);

  return { rawToken, expiresAt };
}

export type ResetPasswordResult =
  | { status: "success" }
  | { status: "invalid_token" }
  | { status: "invalid_password"; message: string };

/**
 * Consume a reset token and set a new password, atomically.
 *
 * Every invariant lives here: policy validation, token lookup by hash, expiry
 * and single-use checks, password hashing, the password update, marking this
 * token used, and invalidating the user's other outstanding tokens - all in one
 * transaction so they succeed or fail together. The action layer only performs
 * form concerns (confirm-password match) and surfaces the result.
 *
 * TODO(security): a password change should also revoke every other active
 * session. This is a no-op today because sessions are stateless JWTs with no
 * server-side session store; when a session store is introduced, revoke the
 * user's other sessions here as part of this transaction.
 */
export async function resetPassword(
  rawToken: string,
  newPassword: string
): Promise<ResetPasswordResult> {
  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.valid) {
    return {
      status: "invalid_password",
      message: passwordCheck.message ?? "Password does not meet requirements",
    };
  }

  const tokenHash = hashToken(rawToken);
  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_COST);
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
      });

      if (!token || token.usedAt || token.expiresAt < now) {
        throw new Error("INVALID_TOKEN");
      }

      await tx.user.update({
        where: { id: token.userId },
        data: { passwordHash },
      });

      // Mark this token used and invalidate the user's other outstanding tokens
      // so no previously issued reset link remains valid.
      await tx.passwordResetToken.updateMany({
        where: { userId: token.userId, usedAt: null },
        data: { usedAt: now },
      });
    });
  } catch (err) {
    if (err instanceof Error && err.message === "INVALID_TOKEN") {
      return { status: "invalid_token" };
    }
    throw err;
  }

  return { status: "success" };
}

/**
 * Whether a raw reset token currently maps to a usable (unused, unexpired)
 * token. Used by the reset page to decide between rendering the form or an
 * "invalid or expired" state.
 */
export async function isValidPasswordResetToken(
  rawToken: string
): Promise<boolean> {
  const tokenHash = hashToken(rawToken);
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
  });
  return Boolean(token && !token.usedAt && token.expiresAt >= new Date());
}
