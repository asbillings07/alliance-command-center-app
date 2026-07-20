import { describe, it, expect } from "vitest";
import { validateDisplayName, DISPLAY_NAME_MAX_LENGTH } from "./account";

describe("validateDisplayName", () => {
  it("accepts a valid name and returns it unchanged", () => {
    const result = validateDisplayName("General Ksana");
    expect(result).toEqual({ ok: true, value: "General Ksana" });
  });

  it("trims surrounding whitespace", () => {
    const result = validateDisplayName("  Kingslayer  ");
    expect(result).toEqual({ ok: true, value: "Kingslayer" });
  });

  it("rejects an empty string", () => {
    const result = validateDisplayName("");
    expect(result).toEqual({ ok: false, message: "Display name is required" });
  });

  it("rejects a whitespace-only string", () => {
    const result = validateDisplayName("   ");
    expect(result.ok).toBe(false);
  });

  it("rejects non-string input", () => {
    expect(validateDisplayName(null).ok).toBe(false);
    expect(validateDisplayName(undefined).ok).toBe(false);
    expect(validateDisplayName(42).ok).toBe(false);
  });

  it("accepts a name exactly at the max length", () => {
    const name = "a".repeat(DISPLAY_NAME_MAX_LENGTH);
    expect(validateDisplayName(name)).toEqual({ ok: true, value: name });
  });

  it("rejects a name longer than the max length", () => {
    const name = "a".repeat(DISPLAY_NAME_MAX_LENGTH + 1);
    const result = validateDisplayName(name);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(String(DISPLAY_NAME_MAX_LENGTH));
    }
  });

  it("measures length after trimming", () => {
    const name = `  ${"a".repeat(DISPLAY_NAME_MAX_LENGTH)}  `;
    expect(validateDisplayName(name).ok).toBe(true);
  });
});
