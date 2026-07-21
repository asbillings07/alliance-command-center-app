import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GoogleAccountMismatchError } from "./identity/errors";

vi.mock("@/app/src/lib/auth/googleConnection", () => ({
  clearLinkIntent: vi.fn(),
  setConnectResult: vi.fn(),
  linkGoogleToUser: vi.fn(),
  logGoogleConnectionEvent: vi.fn(),
}));

vi.mock("@/app/src/lib/auth/session", () => ({
  getSessionVersion: vi.fn(),
}));

import {
  clearLinkIntent,
  setConnectResult,
  linkGoogleToUser,
  logGoogleConnectionEvent,
} from "@/app/src/lib/auth/googleConnection";
import { getSessionVersion } from "@/app/src/lib/auth/session";
import { handleGoogleConnect } from "./handleGoogleConnect";

const mockClearIntent = clearLinkIntent as unknown as ReturnType<typeof vi.fn>;
const mockSetResult = setConnectResult as unknown as ReturnType<typeof vi.fn>;
const mockLink = linkGoogleToUser as unknown as ReturnType<typeof vi.fn>;
const mockLog = logGoogleConnectionEvent as unknown as ReturnType<typeof vi.fn>;
const mockGetVersion = getSessionVersion as unknown as ReturnType<typeof vi.fn>;

const VALID_INTENT = {
  status: "valid" as const,
  userId: "user-1",
  sessionVersion: 3,
  nonce: "nonce-1",
};

// A verified Google profile whose email differs from the app email (connect
// links by subject, not email).
const PROFILE = {
  sub: "google-sub-1",
  email: "personal@gmail.com",
  email_verified: true,
  name: "Leader",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("handleGoogleConnect", () => {
  it("denies an invalid intent (fail closed) without linking", async () => {
    const result = await handleGoogleConnect({ status: "invalid" }, PROFILE);

    expect(result).toBe(false);
    expect(mockClearIntent).toHaveBeenCalledOnce();
    expect(mockSetResult).toHaveBeenCalledWith("intent_expired");
    expect(mockLink).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith("connect_denied", {
      userId: "unknown",
      reason: "invalid_intent",
    });
  });

  it("links the subject and reports connected on success", async () => {
    mockGetVersion.mockResolvedValue(3);
    mockLink.mockResolvedValue(undefined);

    const result = await handleGoogleConnect(VALID_INTENT, PROFILE);

    expect(result).toBe(true);
    expect(mockClearIntent).toHaveBeenCalledOnce();
    expect(mockLink).toHaveBeenCalledWith(
      "user-1",
      "google-sub-1",
      "personal@gmail.com"
    );
    expect(mockSetResult).toHaveBeenCalledWith("connected");
    expect(mockLog).toHaveBeenCalledWith("connected", { userId: "user-1" });
  });

  it("denies when the session version drifted mid-round-trip", async () => {
    mockGetVersion.mockResolvedValue(4); // bumped since the intent was minted

    const result = await handleGoogleConnect(VALID_INTENT, PROFILE);

    expect(result).toBe(false);
    expect(mockSetResult).toHaveBeenCalledWith("intent_expired");
    expect(mockLink).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith("connect_denied", {
      userId: "user-1",
      reason: "session_version_mismatch",
    });
  });

  it("denies when the user no longer exists (null session version)", async () => {
    mockGetVersion.mockResolvedValue(null);

    const result = await handleGoogleConnect(VALID_INTENT, PROFILE);

    expect(result).toBe(false);
    expect(mockSetResult).toHaveBeenCalledWith("intent_expired");
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("denies with already_in_use when the subject is anchored elsewhere", async () => {
    mockGetVersion.mockResolvedValue(3);
    mockLink.mockRejectedValue(new GoogleAccountMismatchError());

    const result = await handleGoogleConnect(VALID_INTENT, PROFILE);

    expect(result).toBe(false);
    expect(mockSetResult).toHaveBeenCalledWith("already_in_use");
    expect(mockLog).toHaveBeenCalledWith("connect_denied", {
      userId: "user-1",
      reason: "subject_unavailable",
    });
  });

  it("denies with a distinct email_unverified result when the Google email is unverified", async () => {
    // assertVerifiedGoogleEmail throws UnverifiedEmailError before any linking;
    // it must surface as its own outcome (not the misleading "already_in_use").
    mockGetVersion.mockResolvedValue(3);

    const result = await handleGoogleConnect(VALID_INTENT, {
      ...PROFILE,
      email_verified: false,
    });

    expect(result).toBe(false);
    expect(mockSetResult).toHaveBeenCalledWith("email_unverified");
    expect(mockLink).not.toHaveBeenCalled();
    expect(mockLog).toHaveBeenCalledWith("connect_denied", {
      userId: "user-1",
      reason: "email_unverified",
    });
  });

  it("denies with unavailable on an unexpected error, without switching identity", async () => {
    mockGetVersion.mockResolvedValue(3);
    mockLink.mockRejectedValue(new Error("db down"));

    const result = await handleGoogleConnect(VALID_INTENT, PROFILE);

    expect(result).toBe(false);
    expect(mockSetResult).toHaveBeenCalledWith("unavailable");
    expect(mockLog).toHaveBeenCalledWith("connect_denied", {
      userId: "user-1",
      reason: "unexpected_error",
    });
  });

  it("denies with unavailable when the profile is missing", async () => {
    const result = await handleGoogleConnect(VALID_INTENT, undefined);

    expect(result).toBe(false);
    expect(mockSetResult).toHaveBeenCalledWith("unavailable");
    expect(mockLink).not.toHaveBeenCalled();
  });

  it("always clears the single-use intent, even when denied", async () => {
    mockGetVersion.mockResolvedValue(4);
    await handleGoogleConnect(VALID_INTENT, PROFILE);
    expect(mockClearIntent).toHaveBeenCalledOnce();
  });
});
