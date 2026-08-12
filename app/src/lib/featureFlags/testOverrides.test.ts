import { describe, it, expect } from "vitest";
import { resolveTestOverride } from "./testOverrides";

const KEYS = ["reports"] as const;

describe("resolveTestOverride", () => {
  it("is a no-op when FEATURE_FLAG_TEST_OVERRIDES is unset", () => {
    expect(
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: undefined,
        vercel: undefined,
        nodeEnv: "production",
        accE2eMode: undefined,
      })
    ).toBeUndefined();
  });

  it("throws when VERCEL is set, regardless of NODE_ENV", () => {
    expect(() =>
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: '{"reports":true}',
        vercel: "1",
        nodeEnv: "test",
        accE2eMode: "1",
      })
    ).toThrow(/Vercel-managed environment/);
  });

  it("throws when VERCEL is set even without ACC_E2E_MODE or NODE_ENV=test", () => {
    expect(() =>
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: '{"reports":true}',
        vercel: "1",
        nodeEnv: "production",
        accE2eMode: undefined,
      })
    ).toThrow(/Vercel-managed environment/);
  });

  it("is allowed under NODE_ENV=test, off Vercel", () => {
    expect(
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: '{"reports":true}',
        vercel: undefined,
        nodeEnv: "test",
        accE2eMode: undefined,
      })
    ).toBe(true);
  });

  it("is allowed under ACC_E2E_MODE=1, off Vercel, even with NODE_ENV=production (next start)", () => {
    expect(
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: '{"reports":true}',
        vercel: undefined,
        nodeEnv: "production",
        accE2eMode: "1",
      })
    ).toBe(true);
  });

  it("throws for an unmarked off-Vercel NODE_ENV=production process (no ACC_E2E_MODE)", () => {
    expect(() =>
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: '{"reports":true}',
        vercel: undefined,
        nodeEnv: "production",
        accE2eMode: undefined,
      })
    ).toThrow(/neither NODE_ENV=test nor marked with ACC_E2E_MODE=1/);
  });

  it("throws for an unmarked off-Vercel NODE_ENV=development process", () => {
    expect(() =>
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: '{"reports":true}',
        vercel: undefined,
        nodeEnv: "development",
        accE2eMode: undefined,
      })
    ).toThrow(/neither NODE_ENV=test nor marked with ACC_E2E_MODE=1/);
  });

  it("throws on malformed JSON", () => {
    expect(() =>
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: "{not-json",
        vercel: undefined,
        nodeEnv: "test",
        accE2eMode: undefined,
      })
    ).toThrow(/valid JSON/);
  });

  it("throws on a JSON array instead of an object", () => {
    expect(() =>
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: "[true]",
        vercel: undefined,
        nodeEnv: "test",
        accE2eMode: undefined,
      })
    ).toThrow(/JSON object/);
  });

  it("throws on an unknown flag key, without partially applying the valid keys in the same map", () => {
    expect(() =>
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: '{"reports":true,"not-a-real-flag":true}',
        vercel: undefined,
        nodeEnv: "test",
        accE2eMode: undefined,
      })
    ).toThrow(/unknown flag key "not-a-real-flag"/);
  });

  it("throws on a non-boolean value", () => {
    expect(() =>
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: '{"reports":"true"}',
        vercel: undefined,
        nodeEnv: "test",
        accE2eMode: undefined,
      })
    ).toThrow(/must be a boolean/);
  });

  it("leaves a registered flag absent from a validly-parsed map unoverridden (falls through)", () => {
    expect(
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: "{}",
        vercel: undefined,
        nodeEnv: "test",
        accE2eMode: undefined,
      })
    ).toBeUndefined();
  });

  it("returns false when explicitly overridden to false", () => {
    expect(
      resolveTestOverride("reports", KEYS, {
        featureFlagTestOverrides: '{"reports":false}',
        vercel: undefined,
        nodeEnv: "test",
        accE2eMode: undefined,
      })
    ).toBe(false);
  });
});
