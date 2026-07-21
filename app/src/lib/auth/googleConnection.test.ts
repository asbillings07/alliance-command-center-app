import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";
import { GoogleAccountMismatchError } from "./identity/errors";

// In-memory cookie jar standing in for next/headers cookies(). Hoisted so the
// vi.mock factory can close over it.
const { jar } = vi.hoisted(() => {
  const map = new Map<string, string>();
  return {
    jar: {
      map,
      get: (name: string) =>
        map.has(name) ? { name, value: map.get(name)! } : undefined,
      set: (name: string, value: string) => {
        map.set(name, value);
      },
      delete: (name: string) => {
        map.delete(name);
      },
    },
  };
});

vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));

vi.mock("@/app/src/lib/prisma", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

vi.mock("@/app/src/lib/auth/ensureGoogleIdentity", () => ({
  ensureGoogleIdentity: vi.fn(),
}));

import { prisma } from "@/app/src/lib/prisma";
import { ensureGoogleIdentity } from "@/app/src/lib/auth/ensureGoogleIdentity";
import {
  clearConnectResult,
  clearLinkIntent,
  disconnectGoogle,
  linkGoogleToUser,
  readConnectResult,
  readLinkIntent,
  setConnectResult,
  setGoogleEmail,
  setLinkIntent,
} from "./googleConnection";

/* eslint-disable @typescript-eslint/no-explicit-any */
const mockPrisma = prisma as any;
const mockEnsure = ensureGoogleIdentity as unknown as ReturnType<typeof vi.fn>;

// Must match the private constants in googleConnection.ts.
const INTENT_COOKIE = "acc_google_link_intent";
const SECRET = "test-auth-secret";

function b64url(value: string): string {
  return Buffer.from(value).toString("base64url");
}

/** Mint a cookie value using the module's scheme: base64url(json).hmac. */
function mintIntentCookie(payload: Record<string, unknown>): string {
  const encoded = b64url(JSON.stringify(payload));
  const sig = createHmac("sha256", SECRET).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    p: "google-connect",
    v: 1,
    uid: "user-1",
    sv: 3,
    nonce: "nonce-1",
    exp: Date.now() + 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  jar.map.clear();
  process.env.AUTH_SECRET = SECRET;
});

afterEach(() => {
  vi.useRealTimers();
});

describe("link intent", () => {
  it("round-trips a freshly set intent as valid", async () => {
    await setLinkIntent({ userId: "user-42", sessionVersion: 7 });

    const result = await readLinkIntent();
    expect(result.status).toBe("valid");
    if (result.status === "valid") {
      expect(result.userId).toBe("user-42");
      expect(result.sessionVersion).toBe(7);
      expect(result.nonce).toEqual(expect.any(String));
    }
  });

  it("returns absent when no cookie is present", async () => {
    expect(await readLinkIntent()).toEqual({ status: "absent" });
  });

  it("clears the intent cookie", async () => {
    await setLinkIntent({ userId: "user-1", sessionVersion: 1 });
    await clearLinkIntent();
    expect(await readLinkIntent()).toEqual({ status: "absent" });
  });

  it("fails closed (invalid) on a tampered signature", async () => {
    await setLinkIntent({ userId: "user-1", sessionVersion: 1 });
    const raw = jar.map.get(INTENT_COOKIE)!;
    const [encoded] = raw.split(".");
    jar.map.set(INTENT_COOKIE, `${encoded}.deadbeef`);

    expect(await readLinkIntent()).toEqual({ status: "invalid" });
  });

  it("fails closed (invalid) on a tampered payload with a stale signature", async () => {
    await setLinkIntent({ userId: "user-1", sessionVersion: 1 });
    const raw = jar.map.get(INTENT_COOKIE)!;
    const [, sig] = raw.split(".");
    // Re-encode a different uid but keep the original signature.
    const forged = b64url(JSON.stringify(validPayload({ uid: "attacker" })));
    jar.map.set(INTENT_COOKIE, `${forged}.${sig}`);

    expect(await readLinkIntent()).toEqual({ status: "invalid" });
  });

  it("fails closed (invalid) when expired, even with a valid signature", async () => {
    jar.map.set(
      INTENT_COOKIE,
      mintIntentCookie(validPayload({ exp: Date.now() - 1 }))
    );
    expect(await readLinkIntent()).toEqual({ status: "invalid" });
  });

  it("fails closed (invalid) on a wrong purpose, even with a valid signature", async () => {
    jar.map.set(
      INTENT_COOKIE,
      mintIntentCookie(validPayload({ p: "something-else" }))
    );
    expect(await readLinkIntent()).toEqual({ status: "invalid" });
  });

  it("fails closed (invalid) on an unknown version", async () => {
    jar.map.set(INTENT_COOKIE, mintIntentCookie(validPayload({ v: 99 })));
    expect(await readLinkIntent()).toEqual({ status: "invalid" });
  });

  it("fails closed (invalid) on a malformed cookie", async () => {
    jar.map.set(INTENT_COOKIE, "not-a-valid-cookie");
    expect(await readLinkIntent()).toEqual({ status: "invalid" });
  });
});

describe("connect-result banner cookie", () => {
  it("round-trips a signed result", async () => {
    await setConnectResult("connected");
    expect(await readConnectResult()).toBe("connected");
  });

  it("returns null when absent", async () => {
    expect(await readConnectResult()).toBeNull();
  });

  it("clears the result cookie", async () => {
    await setConnectResult("already_in_use");
    await clearConnectResult();
    expect(await readConnectResult()).toBeNull();
  });

  it("returns null on a tampered result", async () => {
    await setConnectResult("connected");
    const name = [...jar.map.keys()].find((k) => k !== INTENT_COOKIE)!;
    jar.map.set(name, `${jar.map.get(name)!.split(".")[0]}.deadbeef`);
    expect(await readConnectResult()).toBeNull();
  });
});

describe("linkGoogleToUser", () => {
  it("links the subject, clears the marker, and records the Google email (not User.email)", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      googleSubject: null,
    });
    mockEnsure.mockResolvedValue(undefined);
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    await linkGoogleToUser("user-1", "google-sub-1", "personal@gmail.com");

    // Explicit connect ignores the disconnect flag (no requireAutoLinkEnabled).
    expect(mockEnsure).toHaveBeenCalledWith(
      { id: "user-1", googleSubject: null },
      "google-sub-1"
    );
    // A deliberate reconnect clears the marker and stores the display email,
    // guarded on the subject still being anchored (so a racing disconnect can't
    // be partially undone); it must NOT write `email` (the AllianceHQ identity).
    expect(mockPrisma.user.updateMany).toHaveBeenCalledWith({
      where: { id: "user-1", googleSubject: "google-sub-1" },
      data: { googleAutoLinkBlockedAt: null, googleEmail: "personal@gmail.com" },
    });
    const data = mockPrisma.user.updateMany.mock.calls[0][0].data;
    expect(data.email).toBeUndefined();
  });

  it("rejects (no marker cleared) when the subject cannot be linked", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user-1",
      googleSubject: "another-sub",
    });
    mockEnsure.mockRejectedValue(new GoogleAccountMismatchError());

    await expect(
      linkGoogleToUser("user-1", "google-sub-1", "personal@gmail.com")
    ).rejects.toBeInstanceOf(GoogleAccountMismatchError);

    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });

  it("rejects when the intent's user no longer exists", async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);

    await expect(
      linkGoogleToUser("ghost", "google-sub-1", "personal@gmail.com")
    ).rejects.toBeInstanceOf(GoogleAccountMismatchError);

    expect(mockEnsure).not.toHaveBeenCalled();
    expect(mockPrisma.user.updateMany).not.toHaveBeenCalled();
  });
});

describe("setGoogleEmail", () => {
  it("updates only the display metadata, never User.email", async () => {
    mockPrisma.user.update.mockResolvedValue({});

    await setGoogleEmail("user-1", "personal@gmail.com");

    expect(mockPrisma.user.update).toHaveBeenCalledWith({
      where: { id: "user-1" },
      data: { googleEmail: "personal@gmail.com" },
    });
    const data = mockPrisma.user.update.mock.calls[0][0].data;
    expect(data.email).toBeUndefined();
  });
});

describe("disconnectGoogle", () => {
  it("disconnects with a lockout-guarded write and sets the durable marker", async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 1 });

    const result = await disconnectGoogle("user-1");

    expect(result).toEqual({ status: "success" });
    const call = mockPrisma.user.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      id: "user-1",
      googleSubject: { not: null },
      passwordHash: { not: null },
    });
    expect(call.data.googleSubject).toBeNull();
    // Display metadata is cleared alongside the subject.
    expect(call.data.googleEmail).toBeNull();
    expect(call.data.googleAutoLinkBlockedAt).toBeInstanceOf(Date);
    // No session revocation on disconnect.
    expect(call.data.sessionVersion).toBeUndefined();
    // No re-read needed on the happy path.
    expect(mockPrisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("refuses to disconnect the last sign-in method (no_password)", async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.findUnique.mockResolvedValue({
      googleSubject: "google-sub-1",
      passwordHash: null,
    });

    expect(await disconnectGoogle("user-1")).toEqual({ status: "no_password" });
  });

  it("is a no-op when Google is not connected (not_connected)", async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.findUnique.mockResolvedValue({
      googleSubject: null,
      passwordHash: "hash",
    });

    expect(await disconnectGoogle("user-1")).toEqual({
      status: "not_connected",
    });
  });

  it("reports not_connected when the user has vanished", async () => {
    mockPrisma.user.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.user.findUnique.mockResolvedValue(null);

    expect(await disconnectGoogle("user-1")).toEqual({
      status: "not_connected",
    });
  });
});
