import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@/app/generated/prisma/client";
import {
  beginEmailChange,
  completeEmailChange,
  discardEmailChangeRequest,
  peekEmailChangeRequest,
  validateNewEmail,
  EMAIL_CHANGE_TOKEN_TTL_MS,
} from "./emailChange";

/** A well-formed raw token: 32 bytes rendered as 64 lowercase hex chars. */
const VALID_TOKEN = "a".repeat(64);

// A shared client object is reused as the interactive-transaction `tx` so that
// assertions on prisma.user.updateMany (etc.) see the same mock the callback used.
vi.mock("@/app/src/lib/prisma", () => {
  const client = {
    user: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    emailChangeRequest: {
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
      create: vi.fn(),
      updateMany: vi.fn(),
    },
    invitation: { updateMany: vi.fn() },
    betaInvitation: { updateMany: vi.fn() },
  };
  const $transaction = vi.fn(async (arg: unknown) => {
    if (Array.isArray(arg)) return Promise.all(arg);
    return (arg as (tx: typeof client) => Promise<unknown>)(client);
  });
  return { prisma: { ...client, $transaction } };
});

vi.mock("./account", () => ({ verifyPassword: vi.fn() }));

import { prisma } from "@/app/src/lib/prisma";
import { verifyPassword } from "./account";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;
const mockVerifyPassword = verifyPassword as unknown as ReturnType<typeof vi.fn>;

const USER_ID = "user-1";

/** Configure user.findUnique to answer both by-id and by-email lookups. */
function configureUsers(
  currentUser: { email: string; googleSubject: string | null } | null,
  usersByEmail: Record<string, { id: string }> = {}
) {
  mockPrisma.user.findUnique.mockImplementation(async ({ where }: any) => {
    if (where.id) {
      if (!currentUser) return null;
      return { id: USER_ID, ...currentUser };
    }
    if (where.email) return usersByEmail[where.email] ?? null;
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.emailChangeRequest.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.emailChangeRequest.create.mockImplementation(async ({ data }: any) => ({
    id: "req-1",
    ...data,
  }));
  mockPrisma.emailChangeRequest.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.user.update.mockResolvedValue({});
  mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });
  mockPrisma.invitation.updateMany.mockResolvedValue({ count: 0 });
  mockPrisma.betaInvitation.updateMany.mockResolvedValue({ count: 0 });
});

describe("validateNewEmail", () => {
  it("normalizes and accepts a valid address", () => {
    expect(validateNewEmail("  New@Example.COM ")).toEqual({
      ok: true,
      value: "new@example.com",
    });
  });

  it("rejects malformed input and non-strings", () => {
    expect(validateNewEmail("not-an-email").ok).toBe(false);
    expect(validateNewEmail("a@b").ok).toBe(false);
    expect(validateNewEmail(42 as unknown).ok).toBe(false);
  });
});

describe("beginEmailChange", () => {
  it("rejects a Google-linked account before checking the password", async () => {
    configureUsers({ email: "me@example.com", googleSubject: "g-sub" });

    const result = await beginEmailChange({
      userId: USER_ID,
      newEmail: "new@example.com",
      currentPassword: "pw",
    });

    expect(result).toEqual({ ok: false, reason: "google_linked" });
    expect(mockVerifyPassword).not.toHaveBeenCalled();
    expect(mockPrisma.emailChangeRequest.create).not.toHaveBeenCalled();
  });

  it("rejects an invalid new email", async () => {
    configureUsers({ email: "me@example.com", googleSubject: null });

    const result = await beginEmailChange({
      userId: USER_ID,
      newEmail: "nope",
      currentPassword: "pw",
    });

    expect(result).toEqual({ ok: false, reason: "invalid_email" });
    expect(mockPrisma.emailChangeRequest.create).not.toHaveBeenCalled();
  });

  it("rejects a wrong password and creates nothing", async () => {
    configureUsers({ email: "me@example.com", googleSubject: null });
    mockVerifyPassword.mockResolvedValue(false);

    const result = await beginEmailChange({
      userId: USER_ID,
      newEmail: "new@example.com",
      currentPassword: "wrong",
    });

    expect(result).toEqual({ ok: false, reason: "wrong_password" });
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    expect(mockPrisma.emailChangeRequest.create).not.toHaveBeenCalled();
  });

  it("rejects the same email after normalization", async () => {
    configureUsers({ email: "me@example.com", googleSubject: null });
    mockVerifyPassword.mockResolvedValue(true);

    const result = await beginEmailChange({
      userId: USER_ID,
      newEmail: "ME@Example.com",
      currentPassword: "pw",
    });

    expect(result).toEqual({ ok: false, reason: "same_email" });
  });

  it("rejects an email already used by another account (different casing)", async () => {
    configureUsers(
      { email: "me@example.com", googleSubject: null },
      { "other@example.com": { id: "other" } }
    );
    mockVerifyPassword.mockResolvedValue(true);

    const result = await beginEmailChange({
      userId: USER_ID,
      newEmail: "Other@Example.com",
      currentPassword: "pw",
    });

    expect(result).toEqual({ ok: false, reason: "email_taken" });
  });

  it("supersedes prior unconsumed requests and issues a hashed token", async () => {
    configureUsers({ email: "me@example.com", googleSubject: null });
    mockVerifyPassword.mockResolvedValue(true);

    const before = Date.now();
    const result = await beginEmailChange({
      userId: USER_ID,
      newEmail: "New@Example.com",
      currentPassword: "pw",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The created request's id is returned so the action layer can discard it
    // if delivery fails.
    expect(result.requestId).toBe("req-1");

    // Prior unconsumed requests are deleted (not marked) so consumedAt means
    // "actually confirmed" and a missing row means "superseded".
    expect(mockPrisma.emailChangeRequest.deleteMany).toHaveBeenCalledWith({
      where: { userId: USER_ID, consumedAt: null },
    });

    const createArg = mockPrisma.emailChangeRequest.create.mock.calls[0][0];
    expect(createArg.data.userId).toBe(USER_ID);
    expect(createArg.data.newEmail).toBe("new@example.com");
    // The raw token is 32 random bytes hex; only its SHA-256 hash is stored.
    expect(result.rawToken).toMatch(/^[0-9a-f]{64}$/);
    expect(createArg.data.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(createArg.data.tokenHash).not.toBe(result.rawToken);
    expect(createArg.data.expiresAt.getTime()).toBeGreaterThanOrEqual(
      before + EMAIL_CHANGE_TOKEN_TTL_MS
    );
  });

  it("retries once when a concurrent begin causes a write conflict", async () => {
    configureUsers({ email: "me@example.com", googleSubject: null });
    mockVerifyPassword.mockResolvedValue(true);

    // First serializable transaction loses the race (P2034); the retry succeeds.
    mockPrisma.$transaction.mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError("write conflict", {
        code: "P2034",
        clientVersion: "test",
      })
    );

    const result = await beginEmailChange({
      userId: USER_ID,
      newEmail: "new@example.com",
      currentPassword: "pw",
    });

    expect(result.ok).toBe(true);
    expect(mockPrisma.$transaction).toHaveBeenCalledTimes(2);
  });
});

describe("discardEmailChangeRequest", () => {
  it("deletes only the unconsumed request with the given id", async () => {
    await discardEmailChangeRequest("req-1");

    expect(mockPrisma.emailChangeRequest.deleteMany).toHaveBeenCalledWith({
      where: { id: "req-1", consumedAt: null },
    });
  });
});

describe("completeEmailChange", () => {
  const NEW_EMAIL = "new@example.com";
  const OLD_EMAIL = "old@example.com";

  function validRequest(overrides: Partial<any> = {}) {
    return {
      id: "req-1",
      userId: USER_ID,
      newEmail: NEW_EMAIL,
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
      ...overrides,
    };
  }

  it("rejects a malformed token without hashing or hitting the database", async () => {
    const result = await completeEmailChange("not-a-real-token");
    expect(result).toEqual({ ok: false, reason: "invalid_or_expired" });
    expect(mockPrisma.emailChangeRequest.findUnique).not.toHaveBeenCalled();
  });

  it("rejects a missing token", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(null);

    const result = await completeEmailChange(VALID_TOKEN);
    expect(result).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("rejects an expired token", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(
      validRequest({ expiresAt: new Date(Date.now() - 1000) })
    );

    const result = await completeEmailChange(VALID_TOKEN);
    expect(result).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("rejects an already-consumed (reused) token", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(
      validRequest({ consumedAt: new Date() })
    );

    const result = await completeEmailChange(VALID_TOKEN);
    expect(result).toEqual({ ok: false, reason: "invalid_or_expired" });
  });

  it("rejects when the account became Google-linked after begin (pre-check)", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(validRequest());
    configureUsers({ email: OLD_EMAIL, googleSubject: "g-sub" });

    const result = await completeEmailChange(VALID_TOKEN);
    expect(result).toEqual({ ok: false, reason: "google_linked" });
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a Google link that races in after the pre-check (guarded write)", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(validRequest());
    configureUsers({ email: OLD_EMAIL, googleSubject: null });
    // The pre-check passed, but the guarded identity write (googleSubject: null)
    // now matches zero rows because the account was linked in between.
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });

    const result = await completeEmailChange(VALID_TOKEN);
    expect(result).toEqual({ ok: false, reason: "google_linked" });
  });

  it("rejects when the new email was claimed by another user after begin", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(validRequest());
    configureUsers(
      { email: OLD_EMAIL, googleSubject: null },
      { [NEW_EMAIL]: { id: "someone-else" } }
    );

    const result = await completeEmailChange(VALID_TOKEN);
    expect(result).toEqual({ ok: false, reason: "email_taken" });
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("completes: swaps identity, bumps sessionVersion once, reconciles pending invites", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(validRequest());
    configureUsers({ email: OLD_EMAIL, googleSubject: null });

    const result = await completeEmailChange(VALID_TOKEN);
    expect(result).toEqual({ ok: true, oldEmail: OLD_EMAIL, newEmail: NEW_EMAIL });

    // Guarded consume ran exactly once.
    expect(mockPrisma.emailChangeRequest.updateMany).toHaveBeenCalledTimes(1);

    // Guarded identity update + session revocation, exactly once. The write is
    // guarded on googleSubject: null to close the TOCTOU window.
    expect(mockPrisma.user.updateMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: USER_ID, googleSubject: null },
      data: { email: NEW_EMAIL, sessionVersion: { increment: 1 } },
    });

    // Pending invitations (alliance + beta) re-pointed old -> new; the pending
    // predicates exclude accepted/expired/cancelled/revoked rows.
    const inviteArg = mockPrisma.invitation.updateMany.mock.calls[0][0];
    expect(inviteArg.where.email).toEqual({ equals: OLD_EMAIL, mode: "insensitive" });
    expect(inviteArg.where.acceptedAt).toBeNull();
    expect(inviteArg.where.cancelledAt).toBeNull();
    expect(inviteArg.where.expiresAt).toHaveProperty("gt");
    expect(inviteArg.data).toEqual({ email: NEW_EMAIL });

    const betaArg = mockPrisma.betaInvitation.updateMany.mock.calls[0][0];
    expect(betaArg.where.email).toEqual({ equals: OLD_EMAIL, mode: "insensitive" });
    expect(betaArg.where.acceptedAt).toBeNull();
    expect(betaArg.where.revokedAt).toBeNull();
    expect(betaArg.where.expiresAt).toHaveProperty("gt");
    expect(betaArg.data).toEqual({ email: NEW_EMAIL });
  });

  it("lets exactly one of two racing confirmations win", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(validRequest());
    configureUsers({ email: OLD_EMAIL, googleSubject: null });

    // The loser's guarded consume matches zero rows.
    mockPrisma.emailChangeRequest.updateMany.mockResolvedValueOnce({ count: 0 });

    const loser = await completeEmailChange(VALID_TOKEN);
    expect(loser).toEqual({ ok: false, reason: "invalid_or_expired" });
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();

    // A subsequent attempt whose consume succeeds completes normally.
    const winner = await completeEmailChange(VALID_TOKEN);
    expect(winner.ok).toBe(true);
  });

  it("maps a concurrent unique-constraint violation to email_taken", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(validRequest());
    configureUsers({ email: OLD_EMAIL, googleSubject: null });
    mockPrisma.user.updateMany.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
        code: "P2002",
        clientVersion: "test",
      })
    );

    const result = await completeEmailChange(VALID_TOKEN);
    expect(result).toEqual({ ok: false, reason: "email_taken" });
  });

  it("propagates (rolls back) when invitation reconciliation fails", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue(validRequest());
    configureUsers({ email: OLD_EMAIL, googleSubject: null });
    mockPrisma.invitation.updateMany.mockRejectedValue(new Error("db down"));

    // A non-recoverable failure inside the transaction rethrows; the real
    // $transaction rolls the whole state transition back (nothing changes).
    await expect(completeEmailChange(VALID_TOKEN)).rejects.toThrow("db down");
  });
});

describe("peekEmailChangeRequest", () => {
  it("returns null for a malformed token without hitting the database", async () => {
    const result = await peekEmailChangeRequest("short");
    expect(result).toBeNull();
    expect(mockPrisma.emailChangeRequest.findUnique).not.toHaveBeenCalled();
  });

  it("returns the new email for a valid pending request", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue({
      newEmail: "new@example.com",
      expiresAt: new Date(Date.now() + 60_000),
      consumedAt: null,
    });

    const result = await peekEmailChangeRequest(VALID_TOKEN);
    expect(result).toEqual({ newEmail: "new@example.com" });
  });

  it("returns null for a consumed or expired request", async () => {
    mockPrisma.emailChangeRequest.findUnique.mockResolvedValue({
      newEmail: "new@example.com",
      expiresAt: new Date(Date.now() - 1000),
      consumedAt: null,
    });

    expect(await peekEmailChangeRequest(VALID_TOKEN)).toBeNull();
  });
});
