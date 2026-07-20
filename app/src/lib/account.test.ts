import { describe, it, expect } from "vitest";
import {
  validateDisplayName,
  DISPLAY_NAME_MAX_LENGTH,
  validatePassword,
  PASSWORD_MIN_LENGTH,
  PASSWORD_MAX_BYTES,
} from "./account";

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

describe("validatePassword", () => {
  it("accepts a valid password unchanged", () => {
    const result = validatePassword("correct horse battery");
    expect(result).toEqual({ ok: true, value: "correct horse battery" });
  });

  it("does NOT trim (surrounding whitespace can be intentional)", () => {
    const withSpaces = "  spaced password  ";
    expect(validatePassword(withSpaces)).toEqual({
      ok: true,
      value: withSpaces,
    });
  });

  it("rejects an empty string", () => {
    expect(validatePassword("")).toEqual({
      ok: false,
      message: "Password is required",
    });
  });

  it("rejects non-string input", () => {
    expect(validatePassword(null).ok).toBe(false);
    expect(validatePassword(undefined).ok).toBe(false);
    expect(validatePassword(12345678).ok).toBe(false);
  });

  it("rejects a password shorter than the minimum", () => {
    const result = validatePassword("a".repeat(PASSWORD_MIN_LENGTH - 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(String(PASSWORD_MIN_LENGTH));
    }
  });

  it("accepts a password exactly at the minimum", () => {
    expect(validatePassword("a".repeat(PASSWORD_MIN_LENGTH)).ok).toBe(true);
  });

  it("accepts a password exactly at the maximum byte length", () => {
    expect(validatePassword("a".repeat(PASSWORD_MAX_BYTES)).ok).toBe(true);
  });

  it("rejects a password longer than the maximum (bcrypt 72-byte limit)", () => {
    const result = validatePassword("a".repeat(PASSWORD_MAX_BYTES + 1));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(String(PASSWORD_MAX_BYTES));
    }
  });

  it("measures the max limit in UTF-8 bytes, not JS string length", () => {
    // "あ" is 1 JS character but 3 UTF-8 bytes. 25 of them = 25 chars / 75 bytes:
    // well under a 72-CHARACTER limit, but over the 72-BYTE bcrypt limit.
    const multibyte = "あ".repeat(25);
    expect(multibyte.length).toBeLessThan(PASSWORD_MAX_BYTES);
    expect(Buffer.byteLength(multibyte, "utf8")).toBeGreaterThan(
      PASSWORD_MAX_BYTES
    );

    // Rejected because it exceeds the 72-BYTE bcrypt limit even though it is
    // well under 72 characters. The user-facing copy says "characters" for
    // clarity; the enforcement is on bytes.
    const result = validatePassword(multibyte);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.message).toContain(String(PASSWORD_MAX_BYTES));
    }
  });

  it("accepts a multibyte password that fits within the byte limit", () => {
    // 24 x "あ" = 72 bytes exactly.
    const multibyte = "あ".repeat(24);
    expect(Buffer.byteLength(multibyte, "utf8")).toBe(PASSWORD_MAX_BYTES);
    expect(validatePassword(multibyte)).toEqual({
      ok: true,
      value: multibyte,
    });
  });
});
