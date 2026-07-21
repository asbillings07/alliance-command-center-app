import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { prisma } from "@/app/src/lib/prisma";
import { ensureGoogleIdentity } from "@/app/src/lib/auth/ensureGoogleIdentity";
import { GoogleAccountMismatchError } from "@/app/src/lib/auth/identity/errors";

/**
 * Self-service Google connect / disconnect (ADR-013, #131).
 *
 * This service owns the policy for explicitly linking and unlinking a Google
 * account to the *currently signed-in* user. The Auth.js callback only
 * orchestrates; the rules live here:
 *
 * - Connect is an explicit link to the current user via a signed, session-bound
 *   intent cookie (not an email match), so it is correct even when the app email
 *   and the Google email differ (#144 decoupled email from identity). The Google
 *   OAuth challenge itself is the proof; there is no extra password prompt.
 * - Disconnect clears `googleSubject` only while a password credential remains
 *   (lockout safety) and records `googleAutoLinkBlockedAt` so a later normal
 *   sign-in cannot silently re-link by email. It does not revoke sessions.
 * - Explicit connect clears `googleAutoLinkBlockedAt`: a deliberate reconnect
 *   overrides a prior deliberate disconnect.
 *
 * Nothing here logs subjects, tokens, cookie values, or signatures — only a
 * userId and a coarse reason (see logGoogleConnectionEvent). A full user-facing
 * audit log is #86.
 */

// ============================================================
// Signed, session-bound link intent
// ============================================================

const INTENT_COOKIE = "acc_google_link_intent";
const INTENT_PURPOSE = "google-connect";
const INTENT_VERSION = 1;
/** Intents are short-lived: they only need to survive one OAuth round trip. */
const INTENT_TTL_MS = 10 * 60 * 1000; // 10 minutes

const RESULT_COOKIE = "acc_google_connect_result";
/** The result banner is transient; it only needs to survive the redirect back. */
const RESULT_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * The coarse, non-sensitive outcome of a connect attempt, surfaced to the
 * account page as a banner. Signed (not to protect a secret, but so a user
 * cannot forge a fake "connected" banner) and read-once.
 */
export type GoogleConnectResult =
  | "connected"
  | "already_in_use"
  | "email_unverified"
  | "intent_expired"
  | "unavailable";

const RESULT_VALUES: readonly GoogleConnectResult[] = [
  "connected",
  "already_in_use",
  "email_unverified",
  "intent_expired",
  "unavailable",
];

/**
 * The verified contents of a link intent.
 *
 * `absent` (no attempt) and `invalid` (an attempt we no longer trust) are
 * deliberately distinct: the callback must fail closed on `invalid` and never
 * let it fall through to a normal sign-in, which could switch the browser to a
 * different account.
 */
export type ReadLinkIntentResult =
  | { status: "absent" }
  | {
      status: "valid";
      userId: string;
      sessionVersion: number;
      nonce: string;
    }
  | { status: "invalid" };

type LinkIntentPayload = {
  /** Purpose guard: a cookie minted for anything else is rejected. */
  p: string;
  /** Payload schema version, so the format can evolve without silent misreads. */
  v: number;
  /** The user this intent links Google to (the current session's user). */
  uid: string;
  /** Session version at mint time; re-checked against the DB at callback. */
  sv: number;
  /** Random per-intent value; lets logs/tests reason about a single attempt. */
  nonce: string;
  /** Absolute expiry (ms since epoch). */
  exp: number;
};

function getSigningSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    // The signing key is the same secret Auth.js requires; its absence is a
    // misconfiguration, not a user error.
    throw new Error("AUTH_SECRET must be configured to sign Google link intents");
  }
  return secret;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(value: string): string {
  return createHmac("sha256", getSigningSecret()).update(value).digest("base64url");
}

/** Constant-time compare of two signatures; false on any length/format issue. */
function signaturesMatch(expected: string, actual: string): boolean {
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(actual);
  if (expectedBuf.length !== actualBuf.length) {
    return false;
  }
  return timingSafeEqual(expectedBuf, actualBuf);
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Mint a signed intent that binds an upcoming Google sign-in to the current
 * user and session. Called from the connect action immediately before
 * redirecting to Google. `SameSite=Lax` still rides the top-level callback
 * navigation from Google; the short TTL and sessionVersion binding limit replay.
 */
export async function setLinkIntent(input: {
  userId: string;
  sessionVersion: number;
}): Promise<void> {
  const payload: LinkIntentPayload = {
    p: INTENT_PURPOSE,
    v: INTENT_VERSION,
    uid: input.userId,
    sv: input.sessionVersion,
    nonce: randomBytes(16).toString("base64url"),
    exp: Date.now() + INTENT_TTL_MS,
  };

  const encoded = base64url(JSON.stringify(payload));
  const value = `${encoded}.${sign(encoded)}`;

  const cookieStore = await cookies();
  cookieStore.set(INTENT_COOKIE, value, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(INTENT_TTL_MS / 1000),
  });
}

/**
 * Read and verify the link intent. Fails closed: any tampering, wrong purpose,
 * unknown version, malformed encoding, or expiry yields `invalid` rather than
 * `absent`, so the caller can distinguish "no connect attempt" from "an attempt
 * we refuse to trust". Does not clear the cookie (the caller clears on every
 * terminal outcome).
 */
export async function readLinkIntent(): Promise<ReadLinkIntentResult> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(INTENT_COOKIE)?.value;
  if (!raw) {
    return { status: "absent" };
  }

  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) {
    return { status: "invalid" };
  }

  if (!signaturesMatch(sign(encoded), signature)) {
    return { status: "invalid" };
  }

  let payload: LinkIntentPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    return { status: "invalid" };
  }

  if (
    payload.p !== INTENT_PURPOSE ||
    payload.v !== INTENT_VERSION ||
    typeof payload.uid !== "string" ||
    typeof payload.sv !== "number" ||
    typeof payload.nonce !== "string" ||
    typeof payload.exp !== "number" ||
    payload.exp <= Date.now()
  ) {
    return { status: "invalid" };
  }

  return {
    status: "valid",
    userId: payload.uid,
    sessionVersion: payload.sv,
    nonce: payload.nonce,
  };
}

/** Remove the intent cookie. Called on every terminal connect outcome. */
export async function clearLinkIntent(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(INTENT_COOKIE);
}

// ============================================================
// Connect-result banner cookie (signed, read-once)
// ============================================================

/** Set the transient, signed connect-result banner cookie. */
export async function setConnectResult(result: GoogleConnectResult): Promise<void> {
  const exp = Date.now() + RESULT_TTL_MS;
  const encoded = base64url(`${result}.${exp}`);
  const value = `${encoded}.${sign(encoded)}`;

  const cookieStore = await cookies();
  cookieStore.set(RESULT_COOKIE, value, {
    httpOnly: true,
    secure: isProduction(),
    sameSite: "lax",
    path: "/",
    maxAge: Math.floor(RESULT_TTL_MS / 1000),
  });
}

/**
 * Read (without clearing) the connect-result banner. Returns null for a
 * missing, tampered, or expired cookie. Reading is separated from clearing so
 * it is safe to call from a Server Component render; the acknowledge action
 * clears it.
 */
export async function readConnectResult(): Promise<GoogleConnectResult | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(RESULT_COOKIE)?.value;
  if (!raw) {
    return null;
  }

  const [encoded, signature] = raw.split(".");
  if (!encoded || !signature) {
    return null;
  }
  if (!signaturesMatch(sign(encoded), signature)) {
    return null;
  }

  const decoded = Buffer.from(encoded, "base64url").toString("utf8");
  const [result, expRaw] = decoded.split(".");
  const exp = Number(expRaw);
  if (!Number.isFinite(exp) || exp <= Date.now()) {
    return null;
  }
  if (!RESULT_VALUES.includes(result as GoogleConnectResult)) {
    return null;
  }
  return result as GoogleConnectResult;
}

/** Remove the connect-result banner cookie (after it has been shown). */
export async function clearConnectResult(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(RESULT_COOKIE);
}

// ============================================================
// Domain operations
// ============================================================

/**
 * Explicitly link a Google subject to a specific user (the intent's target).
 *
 * Delegates the subject invariant to `ensureGoogleIdentity` (which refuses to
 * re-point an account already anchored to a different Google account, or to
 * steal a subject already owned by someone else) and then clears
 * `googleAutoLinkBlockedAt`, because a deliberate reconnect overrides a prior
 * deliberate disconnect. Unlike the lazy sign-in path this does NOT set
 * `requireAutoLinkEnabled`: the user is intentionally re-linking.
 *
 * `googleEmail` is the verified Google email, stored only as display metadata
 * (never copied into `User.email`).
 *
 * Throws `GoogleAccountMismatchError` (an AuthenticationError) when the subject
 * cannot be linked; the caller maps that to a denial + banner.
 */
export async function linkGoogleToUser(
  userId: string,
  googleSubject: string,
  googleEmail: string
): Promise<void> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, googleSubject: true },
  });
  if (!user) {
    // The intent's user vanished mid-round-trip (deleted). Treat as a mismatch
    // rather than provisioning anything: connect only ever links existing users.
    throw new GoogleAccountMismatchError();
  }

  await ensureGoogleIdentity(user, googleSubject);

  // Link succeeded (or was already this subject): a deliberate reconnect clears
  // the durable disconnect marker so future normal sign-ins auto-resolve again,
  // and records the connected Google email for display. `User.email` is
  // untouched — Google authenticates, AllianceHQ owns the profile.
  //
  // Guarded on `googleSubject` still being our anchored subject: if a
  // concurrent disconnectGoogle() cleared the subject (and set the marker)
  // between the link above and here, this write matches zero rows rather than
  // clearing the marker while `googleSubject` is null — which would silently
  // re-enable email-match auto-linking and leave inconsistent state.
  await prisma.user.updateMany({
    where: { id: userId, googleSubject },
    data: { googleAutoLinkBlockedAt: null, googleEmail },
  });
}

/**
 * Refresh the stored Google email metadata for a user (display only), so
 * "Connected as <email>" stays current after a normal Google sign-in. Never
 * touches `User.email`. A no-op write is cheap, but callers should only invoke
 * this when the value actually changed.
 */
export async function setGoogleEmail(
  userId: string,
  googleEmail: string
): Promise<void> {
  // Guarded on Google still being connected: a sign-in that began before a
  // concurrent disconnect must not re-write googleEmail afterward and leave
  // stale provider metadata on a now-disconnected account (mirrors the guard in
  // linkGoogleToUser).
  await prisma.user.updateMany({
    where: { id: userId, googleSubject: { not: null } },
    data: { googleEmail },
  });
}

/**
 * The richer discriminated result of a disconnect attempt (consistent with the
 * codebase's other domain results):
 * - success:       Google was connected and a password remained, so it was
 *                  disconnected and the durable marker was set.
 * - no_password:   Google is connected but it is the only sign-in method;
 *                  disconnecting would lock the user out, so it is refused.
 * - not_connected: Google is not connected, so there is nothing to do.
 */
export type DisconnectGoogleResult =
  | { status: "success" }
  | { status: "no_password" }
  | { status: "not_connected" };

/**
 * Disconnect Google from a user, guarding against lockout in a single atomic
 * write: only clear `googleSubject` while both a subject and a password exist.
 * A user must always retain at least one working sign-in method.
 *
 * Sets `googleAutoLinkBlockedAt` (and clears the `googleEmail` display
 * metadata) in the same write so the disconnection is durable — a later normal
 * Google sign-in with a matching email will not silently re-link (see
 * resolveGoogleUser). Does not bump `sessionVersion`: the
 * current session stays valid; the user chose to manage their own account.
 */
export async function disconnectGoogle(
  userId: string
): Promise<DisconnectGoogleResult> {
  const { count } = await prisma.user.updateMany({
    where: {
      id: userId,
      googleSubject: { not: null },
      passwordHash: { not: null },
    },
    data: {
      googleSubject: null,
      googleEmail: null,
      googleAutoLinkBlockedAt: new Date(),
    },
  });

  if (count === 1) {
    return { status: "success" };
  }

  // The guarded write matched nothing. Re-read to explain why so the caller can
  // return precise copy (lockout vs. nothing-to-do).
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { googleSubject: true, passwordHash: true },
  });

  if (!user || user.googleSubject === null) {
    return { status: "not_connected" };
  }
  // Connected but no password: disconnecting would remove the last method.
  return { status: "no_password" };
}

// ============================================================
// Structured logging (userId + reason only)
// ============================================================

export type GoogleConnectionEvent =
  | "connected"
  | "disconnected"
  | "connect_denied"
  | "disconnect_denied";

/**
 * Emit a structured, minimal server-side log line for a connect/disconnect
 * event. Deliberately carries only a userId and a coarse reason — never
 * passwords, Google subjects, tokens, intent values, or signatures.
 */
export function logGoogleConnectionEvent(
  event: GoogleConnectionEvent,
  details: { userId: string; reason?: string }
): void {
  console.info("[google-connection]", {
    event,
    userId: details.userId,
    ...(details.reason ? { reason: details.reason } : {}),
  });
}
