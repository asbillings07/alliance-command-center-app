import { describe, it, expect, afterEach, vi } from "vitest";
import {
  getAppOrigin,
  getRedeemUrl,
  getInviteUrl,
  getEmailChangeVerifyUrl,
} from "./appUrl";

describe("getAppOrigin", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  // The deployment stack selects the origin, not the presence/absence of a var.

  it("uses VERCEL_URL on Preview even when NEXTAUTH_URL is inherited", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    vi.stubEnv("VERCEL_URL", "feature-123.vercel.app");
    expect(getAppOrigin()).toBe("https://feature-123.vercel.app");
  });

  it("throws on Preview when VERCEL_URL is missing", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    vi.stubEnv("VERCEL_URL", "");
    expect(() => getAppOrigin()).toThrow(/VERCEL_URL is required/i);
  });

  it("uses NEXTAUTH_URL in Vercel Production (ignores the internal VERCEL_URL)", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    vi.stubEnv("VERCEL_URL", "deployment.vercel.app");
    expect(getAppOrigin()).toBe("https://alliancehqapp.com");
  });

  it("uses NEXTAUTH_URL and strips a trailing slash", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com/");
    expect(getAppOrigin()).toBe("https://alliancehqapp.com");
  });

  it("reduces a NEXTAUTH_URL with an extra path to its bare origin", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com/some/path");
    expect(getAppOrigin()).toBe("https://alliancehqapp.com");
  });

  // getAppOrigin() treats an empty value as "unset" (truthiness check), so an
  // empty string faithfully simulates an absent env var while staying portable
  // across Vitest versions (vi.stubEnv is typed for string values).
  it("falls back to localhost outside production when nothing is configured", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("NODE_ENV", "development");
    expect(getAppOrigin()).toBe("http://localhost:3000");
  });

  it("throws in production when NEXTAUTH_URL is not configured", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getAppOrigin()).toThrow(/NEXTAUTH_URL is required in production/i);
  });

  it("throws an actionable error when the origin is malformed", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "alliancehqapp.com");
    expect(() => getAppOrigin()).toThrow(
      /NEXTAUTH_URL must be a valid absolute HTTP\(S\) URL/,
    );
  });

  it.each(["javascript:alert(1)", "data:text/plain,x", "file:///tmp/x", "ftp://example.com"])(
    "rejects the unsafe protocol %s",
    (badOrigin) => {
      vi.stubEnv("VERCEL_ENV", "");
      vi.stubEnv("NEXTAUTH_URL", badOrigin);
      expect(() => getAppOrigin()).toThrow(
        /NEXTAUTH_URL must (use http or https|be a valid absolute HTTP\(S\) URL)/,
      );
    },
  );
});

describe("URL builders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("compose against the resolved origin", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    expect(getRedeemUrl("tok123")).toBe("https://alliancehqapp.com/redeem/tok123");
    expect(getInviteUrl("tok789")).toBe("https://alliancehqapp.com/invite/tok789");
    expect(getEmailChangeVerifyUrl("raw456")).toBe(
      "https://alliancehqapp.com/account/email/verify/raw456",
    );
  });

  it("url-encode path tokens so unsafe input cannot break the URL", () => {
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    expect(getInviteUrl("a b/c?d")).toBe(
      "https://alliancehqapp.com/invite/a%20b%2Fc%3Fd",
    );
  });

  it("invite links follow the preview host on a Preview stack", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    vi.stubEnv("VERCEL_URL", "feature-123.vercel.app");
    expect(getInviteUrl("tok789")).toBe(
      "https://feature-123.vercel.app/invite/tok789",
    );
  });
});
