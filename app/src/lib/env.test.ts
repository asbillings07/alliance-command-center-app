import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { validateEnv } from "./env";

// validateEnv() early-returns under NODE_ENV="test" (which Vitest sets), so each
// case stubs an explicit stack. console.error is silenced to keep the expected
// failure output from cluttering the test run.
describe("validateEnv (application origin policy)", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The always-required vars, so tests isolate origin behavior.
    vi.stubEnv("DATABASE_URL", "postgresql://user:pass@localhost:5432/db");
    vi.stubEnv("AUTH_SECRET", "test-secret");
    // Provide the production DB allowlist so the ADR-016 isolation guard is
    // satisfied for the origin-focused cases below (localhost is not a prod
    // identity, so preview/production origin behavior stays isolated here).
    vi.stubEnv("PRODUCTION_DB_HOSTS", "ep-prod-000000");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("passes on Preview with VERCEL_URL and no NEXTAUTH_URL", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL_URL", "feature-123.vercel.app");
    expect(() => validateEnv()).not.toThrow();
  });

  it("fails on Preview missing both, naming VERCEL_URL as the missing source", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    expect(() => validateEnv()).toThrow(/VERCEL_URL/);
  });

  it("still chooses the preview host when both values are present (no throw)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    vi.stubEnv("VERCEL_URL", "feature-123.vercel.app");
    expect(() => validateEnv()).not.toThrow();
  });

  it("fails in Vercel Production when only VERCEL_URL is set (canonical domain required)", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL_URL", "deployment.vercel.app");
    expect(() => validateEnv()).toThrow(/NEXTAUTH_URL/);
  });

  it("fails at startup when the configured origin is malformed", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "not-a-url");
    expect(() => validateEnv()).toThrow(/HTTP\(S\)/);
  });

  it("still enforces the always-required vars", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => validateEnv()).toThrow(/AUTH_SECRET/);
  });

  it("does not crash in development even when the origin is unconfigured", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    expect(() => validateEnv()).not.toThrow();
  });

  // ADR-016 database isolation, wired through validateEnv.
  it("fails on Preview when the DATABASE_URL points at the production database", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "feature-123.vercel.app");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://u:p@ep-prod-000000-pooler.us-east-2.aws.neon.tech/db"
    );
    expect(() => validateEnv()).toThrow(/production/i);
  });

  it("passes in Production when the DATABASE_URL matches PRODUCTION_DB_HOSTS", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXTAUTH_URL", "https://alliancehqapp.com");
    vi.stubEnv(
      "DATABASE_URL",
      "postgresql://u:p@ep-prod-000000.us-east-2.aws.neon.tech/db"
    );
    expect(() => validateEnv()).not.toThrow();
  });

  it("fails on Vercel when PRODUCTION_DB_HOSTS is not configured", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_URL", "feature-123.vercel.app");
    vi.stubEnv("NEXTAUTH_URL", "");
    vi.stubEnv("PRODUCTION_DB_HOSTS", "");
    expect(() => validateEnv()).toThrow(/PRODUCTION_DB_HOSTS/);
  });
});
