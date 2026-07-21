import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { verifyPassword } from "./account";
import { isValidEmailFormat, normalizeEmail } from "./emailAddress";

/**
 * Verified email change (ADR-015).
 *
 * Email is the canonical identity (ADR-013), so changing it is a security
 * workflow, not a profile edit. This service owns persistence, validation,
 * transactions, and policy; the action layer owns auth, request parsing, and
 * email delivery.
 *
 * The lifecycle is a small state machine:
 *
 *   beginEmailChange()   -> re-authenticate, mint a single-use token
 *   confirmEmailChange() -> (action) the user clicks the link and confirms
 *   completeEmailChange()-> atomically swap identity + revoke sessions
 *
 * Security promise: a verified email change is a single-use, two-proof, atomic
 * identity transition that invalidates every existing session. The two proofs
 * are (1) authentication + current password at begin, and (2) ownership of the
 * destination inbox at confirm. There is deliberately no third password prompt.
 *
 * Eligibility is based on the ability to re-authenticate locally, not on which
 * providers are linked: any account with a password credential can change its
 * email, Google-linked or not (#147). Since #144, Google resolves by
 * `googleSubject`, so email is mutable profile data and changing it never
 * breaks Google sign-in. Google-only accounts (no password) set a password
 * first — an existing, supported path — then re-authenticate with it.
 */

/** How long a verification token stays valid after it is issued. */
export const EMAIL_CHANGE_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Thrown inside the completion transaction when the guarded consume fails
 * (already consumed or expired), so a losing racer rolls back cleanly. Used as
 * transaction control flow only; the boundary maps it to an "invalid" result.
 */
export class EmailChangeRequestInvalidError extends Error {
  constructor() {
    super("Email change request is no longer valid");
    this.name = "EmailChangeRequestInvalidError";
  }
}

export type BeginEmailChangeReason =
  | "password_required"
  | "invalid_email"
  | "wrong_password"
  | "same_email"
  | "email_taken";

export type BeginEmailChangeResult =
  | {
      ok: true;
      requestId: string;
      rawToken: string;
      newEmail: string;
      expiresAt: Date;
    }
  | { ok: false; reason: BeginEmailChangeReason };

export type CompleteEmailChangeReason =
  | "invalid_or_expired"
  | "email_taken";

export type CompleteEmailChangeResult =
  | { ok: true; oldEmail: string; newEmail: string }
  | { ok: false; reason: CompleteEmailChangeReason };

/**
 * A well-formed raw token is 32 random bytes rendered as 64 lowercase hex
 * chars. Rejecting anything else before hashing means this unauthenticated
 * endpoint never hashes arbitrarily large input or runs a DB lookup for an
 * obviously-invalid token.
 */
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
function isValidTokenShape(rawToken: string): boolean {
  return TOKEN_PATTERN.test(rawToken);
}

/** The raw token is only ever handed to the user (in the link); we store its hash. */
function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export type ValidateNewEmailResult =
  | { ok: true; value: string }
  | { ok: false };

/** Normalize and format-check a candidate new email. */
export function validateNewEmail(raw: unknown): ValidateNewEmailResult {
  if (typeof raw !== "string") return { ok: false };
  const value = normalizeEmail(raw);
  if (!isValidEmailFormat(value)) return { ok: false };
  return { ok: true, value };
}

/**
 * Begin an email change: re-authenticate the user and, if everything checks
 * out, mint a single-use verification token bound to the new address.
 *
 * Prior unconsumed requests are deleted (not marked) so `consumedAt` strictly
 * means "actually confirmed" and a missing row unambiguously means "superseded".
 * The delete+create runs in a Serializable transaction so two concurrent begins
 * for the same user can't both leave a pending row — the same mechanism
 * betaInvitation uses for its one-pending-per-email invariant (a partial unique
 * index isn't used anywhere in this codebase and would fight Prisma's schema
 * drift detection).
 */
export async function beginEmailChange(input: {
  userId: string;
  newEmail: unknown;
  currentPassword: unknown;
}): Promise<BeginEmailChangeResult> {
  const { userId } = input;
  const currentPassword =
    typeof input.currentPassword === "string" ? input.currentPassword : "";

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, passwordHash: true },
  });
  // A missing user is treated as an auth failure rather than leaking state.
  if (!user) return { ok: false, reason: "wrong_password" };

  // Eligibility is the ability to re-authenticate, not the provider mix (#147):
  // the current password is the second proof. A Google-only account (no
  // password) must set one first, then it becomes eligible. Distinct from
  // wrong_password so the UI can guide the user to set a password.
  if (user.passwordHash === null) {
    return { ok: false, reason: "password_required" };
  }

  const validation = validateNewEmail(input.newEmail);
  if (!validation.ok) return { ok: false, reason: "invalid_email" };
  const newEmail = validation.value;

  // Re-auth before revealing anything about the target address.
  const passwordOk = await verifyPassword(userId, currentPassword);
  if (!passwordOk) return { ok: false, reason: "wrong_password" };

  if (newEmail === normalizeEmail(user.email)) {
    return { ok: false, reason: "same_email" };
  }

  const existing = await prisma.user.findUnique({
    where: { email: newEmail },
    select: { id: true },
  });
  if (existing) return { ok: false, reason: "email_taken" };

  const rawToken = randomBytes(32).toString("hex");
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TOKEN_TTL_MS);

  const supersedeAndCreate = () =>
    prisma.$transaction(
      async (tx) => {
        await tx.emailChangeRequest.deleteMany({
          where: { userId, consumedAt: null },
        });
        return tx.emailChangeRequest.create({
          data: { userId, newEmail, tokenHash, expiresAt },
        });
      },
      { isolationLevel: "Serializable" }
    );

  let created;
  try {
    created = await supersedeAndCreate();
  } catch (err) {
    // Under Serializable isolation a concurrent begin aborts the loser with a
    // write-conflict (P2034). Retry once: the retry's delete clears the winner's
    // row, giving clean last-begin-wins semantics.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2034"
    ) {
      created = await supersedeAndCreate();
    } else {
      throw err;
    }
  }

  return { ok: true, requestId: created.id, rawToken, newEmail, expiresAt };
}

/**
 * Discard a still-pending request by id. Called by the action layer when the
 * verification email fails to send, so a transient provider outage doesn't
 * leave an orphaned pending request behind. Only unconsumed rows are removed,
 * so this can never undo an already-confirmed change.
 */
export async function discardEmailChangeRequest(
  requestId: string
): Promise<void> {
  await prisma.emailChangeRequest.deleteMany({
    where: { id: requestId, consumedAt: null },
  });
}

/**
 * Read-only lookup of a still-valid request by raw token, for rendering the
 * confirmation page. Does not consume anything. Returns null for a missing,
 * consumed, or expired token so the page can show a clear "link no longer
 * valid" state.
 */
export async function peekEmailChangeRequest(
  rawToken: string
): Promise<{ newEmail: string } | null> {
  if (!isValidTokenShape(rawToken)) return null;
  const tokenHash = hashToken(rawToken);
  const request = await prisma.emailChangeRequest.findUnique({
    where: { tokenHash },
    select: { newEmail: true, expiresAt: true, consumedAt: true },
  });
  if (
    !request ||
    request.consumedAt !== null ||
    request.expiresAt <= new Date()
  ) {
    return null;
  }
  return { newEmail: request.newEmail };
}

/**
 * Complete an email change from a raw verification token.
 *
 * Identity update, session revocation, invitation reconciliation, and request
 * consumption are a single atomic state transition: either all of them happen
 * or none do. A guarded conditional consume ensures that when two confirmations
 * race, exactly one wins and the other fails cleanly.
 */
export async function completeEmailChange(
  rawToken: string
): Promise<CompleteEmailChangeResult> {
  if (!isValidTokenShape(rawToken)) {
    return { ok: false, reason: "invalid_or_expired" };
  }
  const tokenHash = hashToken(rawToken);

  const request = await prisma.emailChangeRequest.findUnique({
    where: { tokenHash },
    select: {
      id: true,
      userId: true,
      newEmail: true,
      expiresAt: true,
      consumedAt: true,
    },
  });
  if (
    !request ||
    request.consumedAt !== null ||
    request.expiresAt <= new Date()
  ) {
    return { ok: false, reason: "invalid_or_expired" };
  }

  const user = await prisma.user.findUnique({
    where: { id: request.userId },
    select: { id: true, email: true },
  });
  if (!user) return { ok: false, reason: "invalid_or_expired" };

  const oldEmail = user.email;
  const newEmail = request.newEmail; // normalized at begin

  const claimed = await prisma.user.findUnique({
    where: { email: newEmail },
    select: { id: true },
  });
  if (claimed && claimed.id !== user.id) {
    return { ok: false, reason: "email_taken" };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const now = new Date();

      // Guarded consume: only one racing confirmation can flip consumedAt.
      const consumed = await tx.emailChangeRequest.updateMany({
        where: { id: request.id, consumedAt: null, expiresAt: { gt: now } },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) throw new EmailChangeRequestInvalidError();

      // Identity update + session revocation, atomic with consumption. A
      // guarded write on `id` so a user deleted between the pre-transaction read
      // and here rolls the whole change back cleanly rather than silently
      // no-op'ing. (No Google guard needed: since #144 email is not identity,
      // so changing it is safe regardless of linked providers — #147.)
      const updated = await tx.user.updateMany({
        where: { id: user.id },
        data: { email: newEmail, sessionVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new EmailChangeRequestInvalidError();

      // Invitations belong to the person, not the string: move still-pending
      // invites addressed to the old email onto the new one. Predicates mirror
      // the pending definitions used elsewhere (getPostLoginRedirect / beta).
      await tx.invitation.updateMany({
        where: {
          email: { equals: oldEmail, mode: "insensitive" },
          acceptedAt: null,
          cancelledAt: null,
          expiresAt: { gt: now },
        },
        data: { email: newEmail },
      });
      await tx.betaInvitation.updateMany({
        where: {
          email: { equals: oldEmail, mode: "insensitive" },
          acceptedAt: null,
          revokedAt: null,
          expiresAt: { gt: now },
        },
        data: { email: newEmail },
      });
    });
  } catch (err) {
    if (err instanceof EmailChangeRequestInvalidError) {
      return { ok: false, reason: "invalid_or_expired" };
    }
    // A concurrent claim of the new email surfaces as a unique-constraint
    // violation; the whole transaction rolled back, so report it cleanly.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      return { ok: false, reason: "email_taken" };
    }
    throw err;
  }

  return { ok: true, oldEmail, newEmail };
}
