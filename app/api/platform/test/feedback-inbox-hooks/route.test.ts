import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const mockAuth = vi.fn();
const mockIsPlatformAdmin = vi.fn();
const mockSetFeedbackInboxListQueryFailuresRemaining = vi.fn();
const mockClearFeedbackInboxTestHooks = vi.fn();

vi.mock("@/app/src/lib/auth", () => ({
  auth: () => mockAuth(),
}));

vi.mock("@/app/src/lib/auth/requirePlatformAdmin", () => ({
  isPlatformAdmin: (...args: unknown[]) => mockIsPlatformAdmin(...args),
}));

vi.mock("@/app/src/lib/feedbackInboxTestHooks", () => ({
  setFeedbackInboxListQueryFailuresRemaining: (...args: unknown[]) =>
    mockSetFeedbackInboxListQueryFailuresRemaining(...args),
  clearFeedbackInboxTestHooks: () => mockClearFeedbackInboxTestHooks(),
}));

import { POST, DELETE } from "./route";

function postRequest(body: unknown) {
  return new NextRequest("http://localhost/api/platform/test/feedback-inbox-hooks", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("feedback inbox test-hooks route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("FEEDBACK_INBOX_TEST_HOOKS", "true");
    vi.stubEnv("VERCEL_ENV", "");
    mockAuth.mockResolvedValue({ user: { id: "operator-1" } });
    mockIsPlatformAdmin.mockResolvedValue(true);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("404s when the feature flag is not enabled", async () => {
    vi.stubEnv("FEEDBACK_INBOX_TEST_HOOKS", "");
    const res = await POST(postRequest({ listFailuresRemaining: 1 }));
    expect(res.status).toBe(404);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("404s on a real Vercel production deployment even if the flag is set", async () => {
    // The whole point of this route existing at all is CI's E2E suite, which
    // runs a genuine `next start` production build (NODE_ENV=production) but
    // is never an actual Vercel deployment, so VERCEL_ENV is unset there and
    // the route stays reachable for it. A real Vercel production deploy sets
    // VERCEL_ENV=production itself — not overridable by a stray project env
    // var — so that must always 404 regardless of the feature flag.
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await POST(postRequest({ listFailuresRemaining: 1 }));
    expect(res.status).toBe(404);
    expect(mockAuth).not.toHaveBeenCalled();
    expect(mockSetFeedbackInboxListQueryFailuresRemaining).not.toHaveBeenCalled();
  });

  it("stays reachable when VERCEL_ENV is preview (non-production) and the flag is set", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    const res = await POST(postRequest({ listFailuresRemaining: 1 }));
    expect(res.status).toBe(200);
  });

  it("rejects a non-platform-admin caller", async () => {
    mockIsPlatformAdmin.mockResolvedValue(false);
    const res = await POST(postRequest({ listFailuresRemaining: 1 }));
    expect(res.status).toBe(401);
    expect(mockSetFeedbackInboxListQueryFailuresRemaining).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated caller", async () => {
    mockAuth.mockResolvedValue(null);
    const res = await POST(postRequest({ listFailuresRemaining: 1 }));
    expect(res.status).toBe(401);
  });

  it("rejects a negative listFailuresRemaining", async () => {
    const res = await POST(postRequest({ listFailuresRemaining: -1 }));
    expect(res.status).toBe(400);
    expect(mockSetFeedbackInboxListQueryFailuresRemaining).not.toHaveBeenCalled();
  });

  it("arms the hook for a platform admin with a valid count", async () => {
    const res = await POST(postRequest({ listFailuresRemaining: 2 }));
    expect(res.status).toBe(200);
    expect(mockSetFeedbackInboxListQueryFailuresRemaining).toHaveBeenCalledWith(2);
  });

  it("clears hooks via DELETE for a platform admin", async () => {
    const res = await DELETE();
    expect(res.status).toBe(200);
    expect(mockClearFeedbackInboxTestHooks).toHaveBeenCalled();
  });

  it("404s DELETE on real production even if the flag is set", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await DELETE();
    expect(res.status).toBe(404);
    expect(mockClearFeedbackInboxTestHooks).not.toHaveBeenCalled();
  });
});
