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

  it("uses NEXTAUTH_URL and strips a trailing slash", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com/");
    expect(getAppOrigin()).toBe("https://alliancehqapp.com");
  });

  it("reduces a NEXTAUTH_URL with an extra path to its bare origin", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com/some/path");
    expect(getAppOrigin()).toBe("https://alliancehqapp.com");
  });

  it("prefers NEXTAUTH_URL over VERCEL_URL (production keeps its canonical domain)", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    vi.stubEnv("VERCEL_URL", "some-deploy-abc123.vercel.app");
    expect(getAppOrigin()).toBe("https://alliancehqapp.com");
  });

  it("falls back to https://VERCEL_URL when NEXTAUTH_URL is unset (preview stacks)", () => {
    vi.stubEnv("NEXTAUTH_URL", undefined);
    vi.stubEnv("VERCEL_URL", "acc-git-feature-xyz.vercel.app");
    expect(getAppOrigin()).toBe("https://acc-git-feature-xyz.vercel.app");
  });

  it("falls back to localhost outside production when nothing is configured", () => {
    vi.stubEnv("NEXTAUTH_URL", undefined);
    vi.stubEnv("VERCEL_URL", undefined);
    vi.stubEnv("NODE_ENV", "development");
    expect(getAppOrigin()).toBe("http://localhost:3000");
  });

  it("throws in production when neither NEXTAUTH_URL nor VERCEL_URL is available", () => {
    vi.stubEnv("NEXTAUTH_URL", undefined);
    vi.stubEnv("VERCEL_URL", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(() => getAppOrigin()).toThrow(/origin is not configured/i);
  });
});

describe("URL builders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("compose against the resolved origin", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    expect(getRedeemUrl("tok123")).toBe("https://alliancehqapp.com/redeem/tok123");
    expect(getInviteUrl("tok789")).toBe("https://alliancehqapp.com/invite/tok789");
    expect(getEmailChangeVerifyUrl("raw456")).toBe(
      "https://alliancehqapp.com/account/email/verify/raw456",
    );
  });

  it("invite links follow the preview host when NEXTAUTH_URL is unset", () => {
    vi.stubEnv("NEXTAUTH_URL", undefined);
    vi.stubEnv("VERCEL_URL", "acc-git-feature-xyz.vercel.app");
    expect(getInviteUrl("tok789")).toBe(
      "https://acc-git-feature-xyz.vercel.app/invite/tok789",
    );
  });
});
