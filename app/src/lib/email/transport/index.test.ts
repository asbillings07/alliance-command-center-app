import { describe, it, expect, afterEach, vi } from "vitest";
import { createEmailTransport } from "./index";
import { ResendTransport } from "./resendTransport";
import { LoggingTransport } from "./loggingTransport";
import { AllowlistTransport } from "./allowlistTransport";

describe("createEmailTransport", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses Resend directly when configured outside preview", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    expect(createEmailTransport()).toBeInstanceOf(ResendTransport);
  });

  it("logs (no send) when email is not configured", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("RESEND_API_KEY", "");
    vi.stubEnv("EMAIL_FROM", "");
    expect(createEmailTransport()).toBeInstanceOf(LoggingTransport);
  });

  it("on Preview, refuses to send even with a Resend key when no allowlist is set, and warns distinctly from missing credentials", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    vi.stubEnv("PREVIEW_EMAIL_ALLOWLIST", "");
    expect(createEmailTransport()).toBeInstanceOf(LoggingTransport);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/PREVIEW_EMAIL_ALLOWLIST is empty/));
    warn.mockRestore();
  });

  it("on Preview with an allowlist, wraps Resend in the allowlist gate", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("RESEND_API_KEY", "re_test");
    vi.stubEnv("EMAIL_FROM", "noreply@example.com");
    vi.stubEnv("PREVIEW_EMAIL_ALLOWLIST", "tester@example.com");
    expect(createEmailTransport()).toBeInstanceOf(AllowlistTransport);
  });
});
