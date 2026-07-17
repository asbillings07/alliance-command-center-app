import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { verifyBootstrapSecret } from "./bootstrap";

vi.mock("../prisma", () => ({
  prisma: {
    user: {
      count: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("verifyBootstrapSecret", () => {
  it("returns true when the provided secret matches the configured secret", () => {
    process.env.PLATFORM_BOOTSTRAP_SECRET = "s3cr3t-value";
    expect(verifyBootstrapSecret("s3cr3t-value")).toBe(true);
  });

  it("trims surrounding whitespace before comparing", () => {
    process.env.PLATFORM_BOOTSTRAP_SECRET = "  s3cr3t-value  ";
    expect(verifyBootstrapSecret("s3cr3t-value")).toBe(true);
  });

  it("returns false when the provided secret does not match", () => {
    process.env.PLATFORM_BOOTSTRAP_SECRET = "s3cr3t-value";
    expect(verifyBootstrapSecret("wrong-value")).toBe(false);
  });

  it("returns false for a mismatched secret of different length", () => {
    process.env.PLATFORM_BOOTSTRAP_SECRET = "s3cr3t-value";
    expect(verifyBootstrapSecret("short")).toBe(false);
  });

  it("returns false when a secret is configured but none is provided", () => {
    process.env.PLATFORM_BOOTSTRAP_SECRET = "s3cr3t-value";
    expect(verifyBootstrapSecret(undefined)).toBe(false);
    expect(verifyBootstrapSecret(null)).toBe(false);
    expect(verifyBootstrapSecret("")).toBe(false);
    expect(verifyBootstrapSecret("   ")).toBe(false);
  });

  describe("when no secret is configured", () => {
    beforeEach(() => {
      delete process.env.PLATFORM_BOOTSTRAP_SECRET;
    });

    it("fails closed in production", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(verifyBootstrapSecret("anything")).toBe(false);
      expect(verifyBootstrapSecret(undefined)).toBe(false);
      vi.unstubAllEnvs();
    });

    it("allows bootstrap in development", () => {
      vi.stubEnv("NODE_ENV", "development");
      expect(verifyBootstrapSecret(undefined)).toBe(true);
      vi.unstubAllEnvs();
    });

    it("allows bootstrap in test", () => {
      vi.stubEnv("NODE_ENV", "test");
      expect(verifyBootstrapSecret(undefined)).toBe(true);
      vi.unstubAllEnvs();
    });
  });
});
