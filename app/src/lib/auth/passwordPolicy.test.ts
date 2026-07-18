import { describe, it, expect } from "vitest";
import {
  PASSWORD_RULES,
  PASSWORD_MIN_LENGTH,
  validatePassword,
} from "./passwordPolicy";

describe("passwordPolicy", () => {
  it("accepts a password that satisfies every rule", () => {
    const result = validatePassword("Password123!");
    expect(result.valid).toBe(true);
    expect(result.failedRuleIds).toEqual([]);
    expect(result.message).toBeNull();
  });

  it("requires the minimum length", () => {
    const result = validatePassword("Aa1!");
    expect(result.valid).toBe(false);
    expect(result.failedRuleIds).toContain("length");
    expect(PASSWORD_MIN_LENGTH).toBe(8);
  });

  it.each([
    ["missing uppercase", "password123!", "uppercase"],
    ["missing lowercase", "PASSWORD123!", "lowercase"],
    ["missing number", "Password!!!", "number"],
    ["missing special", "Password1234", "special"],
  ])("flags %s", (_label, password, expectedRuleId) => {
    const result = validatePassword(password);
    expect(result.valid).toBe(false);
    expect(result.failedRuleIds).toContain(expectedRuleId);
  });

  it("reports every failed rule for a weak password", () => {
    const result = validatePassword("weak");
    // "weak" satisfies lowercase only.
    expect(result.failedRuleIds).toEqual([
      "length",
      "uppercase",
      "number",
      "special",
    ]);
    expect(result.message).toMatch(/^Password must include:/);
  });

  it("exposes exactly five rules, each with a stable id and label", () => {
    expect(PASSWORD_RULES).toHaveLength(5);
    for (const rule of PASSWORD_RULES) {
      expect(rule.id).toBeTruthy();
      expect(rule.label).toBeTruthy();
      expect(typeof rule.test).toBe("function");
    }
  });
});
