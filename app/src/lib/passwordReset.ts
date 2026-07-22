import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { validatePassword } from "./password";

/** How long a reset link stays valid. */
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour
const BCRYPT_COST = 12;

/** Shape of a raw reset token: 32 random bytes, hex-encoded. */
const RAW_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/**
 * The partial unique index enforcing "one active (unused) token per user"
 * (migration 20260722010000). Used to recognise the specific collision that
 * represents the concurrency race — see isActiveTokenConflict.
 */
const ACTIVE_TOKEN_INDEX = "PasswordResetToken_userId_active_key";

/**
 * Is this P2002 the expected "another request already holds the single active
 * token" race — as opposed to an unrelated uniqueness failure (e.g. the
 * tokenHash unique) that must NOT be silently swallowed?
 *
 * Prisma surfaces the offending constraint differently across engines: the
 * native binary uses `meta.target`, while the pg driver adapter nests it under
 * `meta.driverAdapterError.cause`. Rather than hard-code a shape, match our
 * index by name anywhere in the reported metadata.
 */
function isActiveTokenConflict(
  err: Prisma.PrismaClientKnownRequestError
): boolean {
  const meta = err.meta as Record<string, unknown> | undefined;
  if (!meta) return false;
  const target = meta.target;
  if (typeof target === "string" && target.includes(ACTIVE_TOKEN_INDEX)) {
    return true;
  }
  if (
    Array.isArray(target) &&
    target.some((t) => String(t).includes(ACTIVE_TOKEN_INDEX))
  ) {
    return true;
  }
  return JSON.stringify(meta).includes(ACTIVE_TOKEN_INDEX);
}

// Lazy-load bcrypt (a native addon) so the forgot-password path — which only
// creates tokens via createPasswordResetToken — never pays to load it. Mirrors
// the pattern in account.ts.
async function getBcrypt() {
  return (await import("bcrypt")).default;
}

export type CreatedPasswordResetToken =
  | {
      /** A fresh token was issued for this request. */
      created: true;
      /** The raw token to embed in the emailed link. Never persisted. */
      rawToken: string;
      expiresAt: Date;
    }
  | {
      /**
       * A concurrent request won the race to issue the single active token
       * (see the partial unique index). This request created nothing; the
       * caller must NOT email a link it doesn't have. The winning request emails
       * the one valid link, so the user still gets exactly one reset email.
       */
      created: false;
    };

/**
 * Hash a raw token for storage/lookup. Reset tokens are high-entropy random
 * values, so a fast SHA-256 (deterministic, no salt) is the right tool — unlike
 * user-chosen passwords, which use bcrypt. Mirrors the email-change token model
 * (ADR-015): only the hash is ever persisted.
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

  try {
    await prisma.$transaction([
      prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: now },
      }),
      prisma.passwordResetToken.create({
        data: { userId, tokenHash, expiresAt },
      }),
    ]);
  } catch (err) {
    // Lost the race to a concurrent request: the partial unique index
    // (one active token per user) rejected this insert, rolling the whole
    // transaction back (so the winner's token stays valid). Report it as
    // "not created" rather than throwing — the caller silently skips emailing.
    // Only THIS specific conflict is benign; any other uniqueness failure is a
    // real invariant violation and must propagate.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002" &&
      isActiveTokenConflict(err)
    ) {
      return { created: false };
    }
    throw err;
  }

  return { created: true, rawToken, expiresAt };
}

export type ResetPasswordResult =
  | { status: "success" }
  | { status: "invalid_token" }
  | { status: "invalid_password"; message: string };

/**
 * Consume a reset token and set a new password, atomically.
 *
 * Every invariant lives here: policy validation, token lookup by hash, a guarded
 * single-use claim, the password update, a session-version bump, and
 * invalidating the user's other outstanding tokens — all in one transaction so
 * they succeed or fail together. The action layer only performs form concerns
 * (confirm-password match) and surfaces the result.
 *
 * Concurrency: the token is claimed with a CONDITIONAL update (unused AND
 * unexpired) that must affect exactly one row. Two racing requests with the same
 * link can't both win — the second sees `count === 0` and is rejected — closing
 * the read-then-write double-use hole.
 *
 * Session invalidation: bumping `sessionVersion` (see ADR / issue #132) revokes
 * every previously issued JWT, so a reset immediately logs out any attacker (or
 * the user's other devices). This is the security point of a reset.
 */
export async function resetPassword(
  rawToken: string,
  newPassword: string
): Promise<ResetPasswordResult> {
  // Policy is main's single source of truth (length-only; ≥8 chars, ≤72 bytes).
  const passwordCheck = validatePassword(newPassword);
  if (!passwordCheck.ok) {
    return { status: "invalid_password", message: passwordCheck.message };
  }

  // Reject structurally-impossible tokens for free, before any hashing or DB
  // work. A well-formed link always matches this shape, so real resets are
  // unaffected; only direct/abusive POSTs are short-circuited.
  if (!RAW_TOKEN_PATTERN.test(rawToken)) {
    return { status: "invalid_token" };
  }

  const tokenHash = hashToken(rawToken);

  // Cheap existence pre-check BEFORE the expensive bcrypt hash. This endpoint is
  // unauthenticated, so hashing on every request with an arbitrary token would
  // be a CPU/DoS vector — bail out on obviously-invalid tokens for free. The
  // AUTHORITATIVE single-use claim still happens inside the transaction below,
  // so this pre-check never weakens the concurrency guarantee. The `<=` here
  // matches the transaction's strict `gt: now`, so a token expiring exactly now
  // is rejected consistently.
  const existing = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { usedAt: true, expiresAt: true },
  });
  if (!existing || existing.usedAt || existing.expiresAt <= new Date()) {
    return { status: "invalid_token" };
  }

  // Hashing is expensive and involves no shared state, so do it OUTSIDE the
  // transaction; the token is still authoritatively rechecked and claimed
  // inside it, so a concurrent consumer can never slip through.
  const bcrypt = await getBcrypt();
  const passwordHash = await bcrypt.hash(passwordCheck.value, BCRYPT_COST);
  const now = new Date();

  try {
    await prisma.$transaction(async (tx) => {
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true },
      });

      if (!token) {
        throw new Error("INVALID_TOKEN");
      }

      // Guarded single-use claim: only succeeds if the token is still unused and
      // unexpired. Requiring exactly one affected row makes concurrent double-use
      // impossible (the loser gets count === 0).
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });

      if (claimed.count !== 1) {
        throw new Error("INVALID_TOKEN");
      }

      // Replace the password AND revoke existing sessions in the same write, so
      // a compromised session can't outlive the reset that was meant to end it.
      await tx.user.update({
        where: { id: token.userId },
        data: {
          passwordHash,
          sessionVersion: { increment: 1 },
        },
      });

      // Invalidate the user's other outstanding tokens so no previously issued
      // reset link remains valid.
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
  if (!RAW_TOKEN_PATTERN.test(rawToken)) return false;
  const tokenHash = hashToken(rawToken);
  const token = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    select: { usedAt: true, expiresAt: true },
  });
  // Strict `>` so this agrees with resetPassword's `expiresAt: { gt: now }`: a
  // token expiring exactly now must not render a form that would fail on submit.
  return Boolean(token && !token.usedAt && token.expiresAt > new Date());
}
