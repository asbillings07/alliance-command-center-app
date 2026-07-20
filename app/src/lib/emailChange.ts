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
 * v1 supports credential-only accounts. Google-linked accounts are refused
 * because sign-in still resolves users by email; see ADR-015 for the path to
 * lift this once Google resolves by `googleSubject`.
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
  | "google_linked"
  | "invalid_email"
  | "wrong_password"
  | "same_email"
  | "email_taken";

export type BeginEmailChangeResult =
  | { ok: true; rawToken: string; newEmail: string; expiresAt: Date }
  | { ok: false; reason: BeginEmailChangeReason };

export type CompleteEmailChangeReason =
  | "invalid_or_expired"
  | "google_linked"
  | "email_taken";

export type CompleteEmailChangeResult =
  | { ok: true; oldEmail: string; newEmail: string }
  | { ok: false; reason: CompleteEmailChangeReason };

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
    select: { email: true, googleSubject: true },
  });
  // A missing user is treated as an auth failure rather than leaking state.
  if (!user) return { ok: false, reason: "wrong_password" };

  // v1: unsupported for Google-linked accounts (ADR-015).
  if (user.googleSubject !== null) return { ok: false, reason: "google_linked" };

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

  await prisma.$transaction([
    prisma.emailChangeRequest.deleteMany({ where: { userId, consumedAt: null } }),
    prisma.emailChangeRequest.create({
      data: { userId, newEmail, tokenHash, expiresAt },
    }),
  ]);

  return { ok: true, rawToken, newEmail, expiresAt };
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
    select: { id: true, email: true, googleSubject: true },
  });
  if (!user) return { ok: false, reason: "invalid_or_expired" };

  // Defensive re-check: the account may have been Google-linked between begin
  // and confirm, invalidating this flow's assumptions (ADR-015).
  if (user.googleSubject !== null) return { ok: false, reason: "google_linked" };

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

      // Identity update + session revocation, atomic with consumption.
      await tx.user.update({
        where: { id: user.id },
        data: { email: newEmail, sessionVersion: { increment: 1 } },
      });

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
